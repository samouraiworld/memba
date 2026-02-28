package service

import (
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"strings"
)

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
type GitHubOAuthExchangeResponse struct {
	Login     string `json:"login"`
	AvatarURL string `json:"avatar_url"`
	Name      string `json:"name"`
	Token     string `json:"token"`
}

// HandleGitHubOAuthExchange exchanges a GitHub OAuth code for an access token
// and returns the GitHub user info. This proxies through the backend because
// GitHub's token exchange endpoint blocks browser CORS.
//
// GET /github/oauth/exchange?code=OAUTH_CODE
func HandleGitHubOAuthExchange() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		code := r.URL.Query().Get("code")
		if code == "" {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": "missing code parameter"})
			return
		}

		clientID := os.Getenv("GITHUB_OAUTH_CLIENT_ID")
		clientSecret := os.Getenv("GITHUB_OAUTH_CLIENT_SECRET")
		if clientID == "" || clientSecret == "" {
			slog.Error("github oauth not configured")
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": "GitHub OAuth not configured"})
			return
		}

		// Exchange code for token
		token, err := exchangeGitHubCode(code, clientID, clientSecret)
		if err != nil {
			slog.Error("github oauth exchange failed", "error", err)
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": "Failed to exchange OAuth code"})
			return
		}

		// Fetch GitHub user info
		user, err := fetchGitHubUser(token)
		if err != nil {
			slog.Error("github user fetch failed", "error", err)
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": "Failed to fetch GitHub user"})
			return
		}

		json.NewEncoder(w).Encode(GitHubOAuthExchangeResponse{
			Login:     user.Login,
			AvatarURL: user.AvatarURL,
			Name:      user.Name,
			Token:     token,
		})
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

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("github token exchange request failed: %w", err)
	}
	defer resp.Body.Close()

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
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("github API returned %d: %s", resp.StatusCode, string(body))
	}

	var user githubUser
	if err := json.NewDecoder(resp.Body).Decode(&user); err != nil {
		return nil, fmt.Errorf("failed to decode github user: %w", err)
	}

	return &user, nil
}
