package service

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
)

// ── CSRF State Store ─────────────────────────────────────────────

const (
	oauthStateTTL     = 10 * time.Minute // state tokens expire after 10 minutes
	oauthStateGCEvery = 5 * time.Minute  // GC stale tokens every 5 minutes
)

type oauthStateEntry struct {
	expiry time.Time
}

// OAuthStateStore manages CSRF state tokens for GitHub OAuth.
type OAuthStateStore struct {
	mu      sync.Mutex
	entries map[string]oauthStateEntry
}

// NewOAuthStateStore creates a new state store and starts a GC goroutine.
func NewOAuthStateStore(ctx context.Context) *OAuthStateStore {
	s := &OAuthStateStore{entries: make(map[string]oauthStateEntry)}
	go func() {
		ticker := time.NewTicker(oauthStateGCEvery)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				s.mu.Lock()
				now := time.Now()
				for k, v := range s.entries {
					if now.After(v.expiry) {
						delete(s.entries, k)
					}
				}
				s.mu.Unlock()
			}
		}
	}()
	return s
}

// Generate creates a new cryptographically random state token and stores it.
func (s *OAuthStateStore) Generate() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("failed to generate state token: %w", err)
	}
	token := hex.EncodeToString(b)
	s.mu.Lock()
	s.entries[token] = oauthStateEntry{expiry: time.Now().Add(oauthStateTTL)}
	s.mu.Unlock()
	return token, nil
}

// Validate checks and consumes a state token (one-time use).
func (s *OAuthStateStore) Validate(token string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	entry, ok := s.entries[token]
	if !ok {
		return false
	}
	delete(s.entries, token) // one-time use
	return time.Now().Before(entry.expiry)
}

// ── GitHub OAuth Types ───────────────────────────────────────────

// githubTokenResponse is the response from GitHub's OAuth token exchange.
type githubTokenResponse struct {
	AccessToken string `json:"access_token"`
	TokenType   string `json:"token_type"`
	Scope       string `json:"scope"`
}

// githubUser is the minimal GitHub user info we need.
type githubUser struct {
	Login     string `json:"login"`
	AvatarURL string `json:"avatar_url"`
	Name      string `json:"name"`
}

// GitHubOAuthExchangeResponse is returned to the frontend.
// v5 security: Token field removed — GitHub access token stays server-side only.
type GitHubOAuthExchangeResponse struct {
	Login     string `json:"login"`
	AvatarURL string `json:"avatar_url"`
	Name      string `json:"name"`
}

// ── Handlers ─────────────────────────────────────────────────────

// HandleGitHubOAuthState generates a CSRF state token for the OAuth flow.
//
// GET /github/oauth/state → {"state": "<hex>"}
func HandleGitHubOAuthState(store *OAuthStateStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		state, err := store.Generate()
		if err != nil {
			slog.Error("failed to generate oauth state", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			writeJSON(w, map[string]string{"error": "failed to generate state"})
			return
		}
		writeJSON(w, map[string]string{"state": state})
	}
}

// HandleGitHubOAuthExchange exchanges a GitHub OAuth code for an access token
// and returns the GitHub user info. Validates the CSRF state parameter.
//
// GET /github/oauth/exchange?code=OAUTH_CODE&state=STATE_TOKEN
func HandleGitHubOAuthExchange(store *OAuthStateStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		// Validate CSRF state parameter
		state := r.URL.Query().Get("state")
		if state == "" {
			w.WriteHeader(http.StatusBadRequest)
			writeJSON(w, map[string]string{"error": "missing state parameter"})
			return
		}
		if !store.Validate(state) {
			slog.Warn("invalid or expired oauth state", "state_prefix", state[:min(8, len(state))])
			w.WriteHeader(http.StatusForbidden)
			writeJSON(w, map[string]string{"error": "invalid or expired state token (CSRF protection)"})
			return
		}

		code := r.URL.Query().Get("code")
		if code == "" {
			w.WriteHeader(http.StatusBadRequest)
			writeJSON(w, map[string]string{"error": "missing code parameter"})
			return
		}

		clientID := os.Getenv("GITHUB_OAUTH_CLIENT_ID")
		clientSecret := os.Getenv("GITHUB_OAUTH_CLIENT_SECRET")
		if clientID == "" || clientSecret == "" {
			slog.Error("github oauth not configured")
			w.WriteHeader(http.StatusInternalServerError)
			writeJSON(w, map[string]string{"error": "GitHub OAuth not configured"})
			return
		}

		// Exchange code for token
		token, err := exchangeGitHubCode(code, clientID, clientSecret)
		if err != nil {
			slog.Error("github oauth exchange failed", "error", err)
			w.WriteHeader(http.StatusBadRequest)
			writeJSON(w, map[string]string{"error": "Failed to exchange OAuth code"})
			return
		}

		// Fetch GitHub user info
		user, err := fetchGitHubUser(token)
		if err != nil {
			slog.Error("github user fetch failed", "error", err)
			w.WriteHeader(http.StatusBadRequest)
			writeJSON(w, map[string]string{"error": "Failed to fetch GitHub user"})
			return
		}

		writeJSON(w, GitHubOAuthExchangeResponse{
			Login:     user.Login,
			AvatarURL: user.AvatarURL,
			Name:      user.Name,
		})
	}
}

// writeJSON encodes v as JSON to w, logging any encode error.
func writeJSON(w http.ResponseWriter, v any) {
	if err := json.NewEncoder(w).Encode(v); err != nil {
		slog.Error("json encode failed", "error", err)
	}
}

func exchangeGitHubCode(code, clientID, clientSecret string) (string, error) {
	body := fmt.Sprintf("client_id=%s&client_secret=%s&code=%s", clientID, clientSecret, code)

	req, err := http.NewRequest("POST", "https://github.com/login/oauth/access_token", strings.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := http.DefaultClient.Do(req) // #nosec G704 -- URL is hardcoded GitHub API endpoint, not user-controlled
	if err != nil {
		return "", fmt.Errorf("github token exchange request failed: %w", err)
	}
	defer func() {
		if err := resp.Body.Close(); err != nil {
			slog.Error("failed to close response body", "error", err)
		}
	}()

	var tokenResp githubTokenResponse
	if err := json.NewDecoder(resp.Body).Decode(&tokenResp); err != nil {
		return "", fmt.Errorf("failed to decode token response: %w", err)
	}

	if tokenResp.AccessToken == "" {
		return "", fmt.Errorf("empty access token from GitHub")
	}

	return tokenResp.AccessToken, nil
}

func fetchGitHubUser(token string) (*githubUser, error) {
	req, err := http.NewRequest("GET", "https://api.github.com/user", nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/vnd.github.v3+json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("github user request failed: %w", err)
	}
	defer func() {
		if err := resp.Body.Close(); err != nil {
			slog.Error("failed to close response body", "error", err)
		}
	}()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20)) // 1 MB cap
		return nil, fmt.Errorf("github API returned %d: %s", resp.StatusCode, string(body))
	}

	var user githubUser
	if err := json.NewDecoder(resp.Body).Decode(&user); err != nil {
		return nil, fmt.Errorf("failed to decode github user: %w", err)
	}

	return &user, nil
}
