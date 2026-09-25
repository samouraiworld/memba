package service

import (
	"context"
	"database/sql"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"connectrpc.com/connect"
	membav1 "github.com/samouraiworld/memba/backend/gen/memba/v1"
)

// fakeGitHub stands in for github.com + api.github.com behind githubHTTPClient,
// so the exchange handler runs end to end without the network.
type fakeGitHub struct {
	mu         sync.Mutex
	calls      int
	userStatus int
	userBody   string
}

func (f *fakeGitHub) RoundTrip(r *http.Request) (*http.Response, error) {
	f.mu.Lock()
	f.calls++
	f.mu.Unlock()
	resp := func(status int, body string) *http.Response {
		return &http.Response{
			StatusCode: status,
			Header:     http.Header{"Content-Type": []string{"application/json"}},
			Body:       io.NopCloser(strings.NewReader(body)),
			Request:    r,
		}
	}
	switch r.URL.Host + r.URL.Path {
	case "github.com/login/oauth/access_token":
		return resp(http.StatusOK, `{"access_token":"gho_test","token_type":"bearer","scope":"read:user"}`), nil
	case "api.github.com/user":
		return resp(f.userStatus, f.userBody), nil
	}
	return resp(http.StatusNotFound, `{}`), nil
}

func (f *fakeGitHub) callCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.calls
}

// installFakeGitHub swaps githubHTTPClient for one backed by a fake GitHub that
// reports the given login, and sets the OAuth app credentials the handler needs.
func installFakeGitHub(t *testing.T, login string) *fakeGitHub {
	t.Helper()
	fake := &fakeGitHub{
		userStatus: http.StatusOK,
		userBody:   `{"login":"` + login + `","avatar_url":"https://avatars.githubusercontent.com/u/1","name":"Test User"}`,
	}
	orig := githubHTTPClient
	githubHTTPClient = &http.Client{Transport: fake}
	t.Cleanup(func() { githubHTTPClient = orig })
	t.Setenv("GITHUB_OAUTH_CLIENT_ID", "test-client-id")
	t.Setenv("GITHUB_OAUTH_CLIENT_SECRET", "test-client-secret")
	return fake
}

// runExchange calls the exchange handler. wallet is the address the route's
// auth middleware would put in the context; "" leaves it out, which the handler
// must refuse on its own.
func runExchange(t *testing.T, h *testHarness, store *OAuthStateStore, wallet, state string) *httptest.ResponseRecorder {
	t.Helper()
	r := httptest.NewRequest(http.MethodGet, "/github/oauth/exchange?code=abc&state="+state, nil)
	if wallet != "" {
		r = r.WithContext(WithAuthAddress(r.Context(), wallet))
	}
	rr := httptest.NewRecorder()
	HandleGitHubOAuthExchange(store, h.db).ServeHTTP(rr, r)
	return rr
}

type storedProfile struct {
	bio, company, title, avatarURL, twitter, github, website, updatedAt string
}

func readStoredProfile(t *testing.T, db *sql.DB, addr string) (storedProfile, bool) {
	t.Helper()
	var p storedProfile
	err := db.QueryRow(`SELECT bio, company, title, avatar_url, twitter, github, website, updated_at FROM profiles WHERE address = ?`, addr).
		Scan(&p.bio, &p.company, &p.title, &p.avatarURL, &p.twitter, &p.github, &p.website, &p.updatedAt)
	if err == sql.ErrNoRows {
		return p, false
	}
	if err != nil {
		t.Fatalf("read profile %s: %v", addr, err)
	}
	return p, true
}

func seedProfile(t *testing.T, db *sql.DB, addr string, p storedProfile) {
	t.Helper()
	_, err := db.Exec(`INSERT INTO profiles (address, bio, company, title, avatar_url, twitter, github, website, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		addr, p.bio, p.company, p.title, p.avatarURL, p.twitter, p.github, p.website, p.updatedAt)
	if err != nil {
		t.Fatalf("seed profile %s: %v", addr, err)
	}
}

func newTestStateStore(t *testing.T) *OAuthStateStore {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	return NewOAuthStateStore(ctx)
}

// Without an authenticated wallet the exchange refuses before touching GitHub,
// the CSRF state, or the database.
func TestGitHubOAuthExchange_RequiresAuthenticatedWallet(t *testing.T) {
	h := setup(t)
	fake := installFakeGitHub(t, "octocat")
	store := newTestStateStore(t)
	state, _ := store.Generate("g1linker")

	rr := runExchange(t, h, store, "", state)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("want 401, got %d (%s)", rr.Code, rr.Body.String())
	}
	if n := fake.callCount(); n != 0 {
		t.Fatalf("GitHub must not be called without auth, got %d calls", n)
	}
	var count int
	if err := h.db.QueryRow(`SELECT COUNT(*) FROM profiles`).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatalf("no profile may be written without auth, found %d rows", count)
	}
	if !store.Validate(state, "g1linker") {
		t.Fatal("a refused request must not consume the CSRF state")
	}
}

// A verified exchange writes github for the authenticated wallet and leaves
// every other column, and every other wallet's row, untouched.
func TestGitHubOAuthExchange_WritesOnlyGithubForAuthenticatedWallet(t *testing.T) {
	h := setup(t)
	installFakeGitHub(t, "octocat")
	store := newTestStateStore(t)
	state, _ := store.Generate("g1linker")

	const wallet = "g1linker"
	before := storedProfile{
		bio: "my bio", company: "Samourai", title: "Dev", avatarURL: "https://example.com/a.png",
		twitter: "@me", github: "https://github.com/someone-else", website: "https://example.com",
		updatedAt: "2026-01-02T03:04:05Z",
	}
	seedProfile(t, h.db, wallet, before)
	other := storedProfile{bio: "other", github: "https://github.com/other", updatedAt: "2026-01-01T00:00:00Z"}
	seedProfile(t, h.db, "g1other", other)

	rr := runExchange(t, h, store, wallet, state)
	if rr.Code != http.StatusOK {
		t.Fatalf("want 200, got %d (%s)", rr.Code, rr.Body.String())
	}
	var body GitHubOAuthExchangeResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if body.Login != "octocat" {
		t.Fatalf("want login octocat, got %q", body.Login)
	}

	after, ok := readStoredProfile(t, h.db, wallet)
	if !ok {
		t.Fatal("profile row missing after exchange")
	}
	want := before
	want.github = "https://github.com/octocat"
	if after != want {
		t.Fatalf("only github may change:\n got %+v\nwant %+v", after, want)
	}
	if got, _ := readStoredProfile(t, h.db, "g1other"); got != other {
		t.Fatalf("another wallet's profile changed: %+v", got)
	}
}

// A wallet with no profile row yet gets one holding just the verified link.
func TestGitHubOAuthExchange_CreatesProfileRow(t *testing.T) {
	h := setup(t)
	installFakeGitHub(t, "octocat")
	store := newTestStateStore(t)
	state, _ := store.Generate("g1fresh")

	rr := runExchange(t, h, store, "g1fresh", state)
	if rr.Code != http.StatusOK {
		t.Fatalf("want 200, got %d (%s)", rr.Code, rr.Body.String())
	}
	p, ok := readStoredProfile(t, h.db, "g1fresh")
	if !ok {
		t.Fatal("expected a profile row to be created")
	}
	if p.github != "https://github.com/octocat" {
		t.Fatalf("want verified github link, got %q", p.github)
	}
	if p.bio != "" || p.company != "" || p.title != "" || p.avatarURL != "" || p.twitter != "" || p.website != "" {
		t.Fatalf("new row must only carry github, got %+v", p)
	}
}

// The CSRF state check still runs for authenticated callers: a missing or
// unknown state is refused before GitHub is contacted and nothing is written.
func TestGitHubOAuthExchange_EnforcesCSRFState(t *testing.T) {
	h := setup(t)
	fake := installFakeGitHub(t, "octocat")
	store := newTestStateStore(t)

	if rr := runExchange(t, h, store, "g1linker", ""); rr.Code != http.StatusBadRequest {
		t.Fatalf("missing state: want 400, got %d", rr.Code)
	}
	if rr := runExchange(t, h, store, "g1linker", "not-a-real-state"); rr.Code != http.StatusForbidden {
		t.Fatalf("unknown state: want 403, got %d", rr.Code)
	}
	if n := fake.callCount(); n != 0 {
		t.Fatalf("GitHub must not be called on a CSRF failure, got %d calls", n)
	}
	if _, ok := readStoredProfile(t, h.db, "g1linker"); ok {
		t.Fatal("no profile may be written on a CSRF failure")
	}
}

// If GitHub does not confirm a login, the stored link is left as it was.
func TestGitHubOAuthExchange_GitHubFailureWritesNothing(t *testing.T) {
	h := setup(t)
	fake := installFakeGitHub(t, "octocat")
	store := newTestStateStore(t)
	seedProfile(t, h.db, "g1linker", storedProfile{github: "https://github.com/kept", updatedAt: "2026-01-01T00:00:00Z"})

	for name, tc := range map[string]struct {
		status int
		body   string
	}{
		"user endpoint error": {http.StatusUnauthorized, `{"message":"Bad credentials"}`},
		"empty login":         {http.StatusOK, `{"login":""}`},
	} {
		fake.userStatus, fake.userBody = tc.status, tc.body
		state, _ := store.Generate("g1linker")
		rr := runExchange(t, h, store, "g1linker", state)
		if rr.Code == http.StatusOK {
			t.Fatalf("%s: want an error status, got 200", name)
		}
		if p, _ := readStoredProfile(t, h.db, "g1linker"); p.github != "https://github.com/kept" {
			t.Fatalf("%s: stored github changed to %q", name, p.github)
		}
	}
}

// The frontend sends the session token as snake_case JSON (the Go/proto field
// names) in the Authorization header; that shape must authenticate.
func TestValidateRESTTokenAddress_AcceptsSnakeCaseTokenJSON(t *testing.T) {
	h := setup(t)
	tok := h.makeToken(t, "g1linker")
	raw, err := json.Marshal(map[string]string{
		"nonce":            tok.Nonce,
		"expiration":       tok.Expiration,
		"user_address":     tok.UserAddress,
		"server_signature": tok.ServerSignature,
		"chain_id":         tok.ChainId,
	})
	if err != nil {
		t.Fatal(err)
	}
	addr, err := h.svc.ValidateRESTTokenAddress(string(raw))
	if err != nil || addr != "g1linker" {
		t.Fatalf("snake_case token must authenticate, got addr=%q err=%v", addr, err)
	}
}

// ── UpdateProfile github handling ────────────────────────────────

func updateProfileGithub(t *testing.T, h *testHarness, addr, github string) *membav1.Profile {
	t.Helper()
	resp, err := h.svc.UpdateProfile(t.Context(), connect.NewRequest(&membav1.UpdateProfileRequest{
		AuthToken: h.makeToken(t, addr),
		Profile:   &membav1.Profile{Address: addr, Bio: "updated bio", Github: github},
	}))
	if err != nil {
		t.Fatalf("UpdateProfile: %v", err)
	}
	return resp.Msg.Profile
}

// A client cannot set github to a new value through UpdateProfile: the
// verified link stays, while the rest of the update still applies.
func TestUpdateProfile_IgnoresClientGithubValue(t *testing.T) {
	h := setup(t)
	const addr = "g1linked"
	seedProfile(t, h.db, addr, storedProfile{github: "https://github.com/verified", updatedAt: "2026-01-01T00:00:00Z"})

	got := updateProfileGithub(t, h, addr, "https://github.com/impostor")
	if got.Github != "https://github.com/verified" {
		t.Fatalf("response must carry the stored link, got %q", got.Github)
	}
	p, _ := readStoredProfile(t, h.db, addr)
	if p.github != "https://github.com/verified" {
		t.Fatalf("stored github must be kept, got %q", p.github)
	}
	if p.bio != "updated bio" {
		t.Fatalf("other fields must still update, got bio %q", p.bio)
	}
}

// With no verified link on file, a client-supplied github is not stored.
func TestUpdateProfile_CannotCreateGithubLink(t *testing.T) {
	h := setup(t)
	const addr = "g1newuser"

	got := updateProfileGithub(t, h, addr, "https://github.com/impostor")
	if got.Github != "" {
		t.Fatalf("response must not echo an unverified link, got %q", got.Github)
	}
	p, ok := readStoredProfile(t, h.db, addr)
	if !ok {
		t.Fatal("profile row missing")
	}
	if p.github != "" {
		t.Fatalf("unverified github must not be stored, got %q", p.github)
	}
}

// An empty github unlinks: the stored link is cleared.
func TestUpdateProfile_EmptyGithubUnlinks(t *testing.T) {
	h := setup(t)
	const addr = "g1linked"
	seedProfile(t, h.db, addr, storedProfile{github: "https://github.com/verified", updatedAt: "2026-01-01T00:00:00Z"})

	got := updateProfileGithub(t, h, addr, "")
	if got.Github != "" {
		t.Fatalf("response must show the link cleared, got %q", got.Github)
	}
	if p, _ := readStoredProfile(t, h.db, addr); p.github != "" {
		t.Fatalf("stored github must be cleared, got %q", p.github)
	}
}

// Login CSRF: an attacker mints a state in their own session, authorizes
// their own GitHub account, and sends the victim the callback link. The
// victim's exchange carries the victim's wallet, so the state is refused
// before GitHub is called and nothing is linked.
func TestGitHubOAuthExchange_RefusesStateIssuedToAnotherWallet(t *testing.T) {
	h := setup(t)
	fake := installFakeGitHub(t, "attacker-gh")
	store := newTestStateStore(t)
	attackerState, _ := store.Generate("g1attacker")

	rr := runExchange(t, h, store, "g1victim", attackerState)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("want 403, got %d (%s)", rr.Code, rr.Body.String())
	}
	if n := fake.callCount(); n != 0 {
		t.Fatalf("GitHub must not be called for a foreign state, got %d calls", n)
	}
	if p, ok := readStoredProfile(t, h.db, "g1victim"); ok && p.github != "" {
		t.Fatalf("victim's github was set to %q", p.github)
	}
}
