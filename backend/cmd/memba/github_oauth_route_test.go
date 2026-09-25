package main

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/samouraiworld/memba/backend/internal/service"
)

// The GitHub OAuth exchange route links the GitHub account to the caller's
// wallet, so it must refuse a request without a valid wallet session token
// before the handler runs: 401, the CSRF state left unconsumed, no DB access
// (the nil database would panic if the handler were reached).
func TestGitHubOAuthExchangeRoute_RequiresWalletToken(t *testing.T) {
	store := service.NewOAuthStateStore(t.Context())

	cases := map[string]struct {
		header string
		v      *fakeTokenAddressValidator
	}{
		"missing header":   {"", &fakeTokenAddressValidator{addr: "g1wallet"}},
		"non-bearer":       {"Basic abc", &fakeTokenAddressValidator{addr: "g1wallet"}},
		"invalid token":    {"Bearer {}", &fakeTokenAddressValidator{err: errors.New("bad signature")}},
		"no address in it": {"Bearer {}", &fakeTokenAddressValidator{addr: ""}},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			state, err := store.Generate("g1wallet")
			if err != nil {
				t.Fatal(err)
			}
			r := httptest.NewRequest(http.MethodGet, "/github/oauth/exchange?code=abc&state="+state, nil)
			if tc.header != "" {
				r.Header.Set("Authorization", tc.header)
			}
			rr := httptest.NewRecorder()
			githubOAuthExchangeHandler(tc.v, store, nil).ServeHTTP(rr, r)
			if rr.Code != http.StatusUnauthorized {
				t.Fatalf("want 401, got %d (%s)", rr.Code, rr.Body.String())
			}
			if !store.Validate(state, "g1wallet") {
				t.Fatal("a refused request must not consume the CSRF state")
			}
		})
	}
}

// The state route binds the state to the caller's wallet, so it needs the
// session token too: 401 without one, and nothing is issued.
func TestGitHubOAuthStateRoute_RequiresWalletToken(t *testing.T) {
	store := service.NewOAuthStateStore(t.Context())
	for name, tc := range map[string]struct {
		header string
		v      *fakeTokenAddressValidator
	}{
		"missing header": {"", &fakeTokenAddressValidator{addr: "g1wallet"}},
		"invalid token":  {"Bearer {}", &fakeTokenAddressValidator{err: errors.New("bad signature")}},
	} {
		t.Run(name, func(t *testing.T) {
			r := httptest.NewRequest(http.MethodGet, "/github/oauth/state", nil)
			if tc.header != "" {
				r.Header.Set("Authorization", tc.header)
			}
			rr := httptest.NewRecorder()
			githubOAuthStateHandler(tc.v, store).ServeHTTP(rr, r)
			if rr.Code != http.StatusUnauthorized {
				t.Fatalf("want 401, got %d (%s)", rr.Code, rr.Body.String())
			}
		})
	}

	// With a session, the issued state validates only for that wallet.
	r := httptest.NewRequest(http.MethodGet, "/github/oauth/state", nil)
	r.Header.Set("Authorization", "Bearer {}")
	rr := httptest.NewRecorder()
	githubOAuthStateHandler(&fakeTokenAddressValidator{addr: "g1wallet"}, store).ServeHTTP(rr, r)
	if rr.Code != http.StatusOK {
		t.Fatalf("want 200, got %d (%s)", rr.Code, rr.Body.String())
	}
	var body struct{ State string `json:"state"` }
	if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil || body.State == "" {
		t.Fatalf("decode state: %v (%s)", err, rr.Body.String())
	}
	if store.Validate(body.State, "g1other") {
		t.Fatal("a state issued to g1wallet must not validate for another wallet")
	}
}
