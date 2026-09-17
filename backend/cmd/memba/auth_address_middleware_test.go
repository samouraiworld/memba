package main

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/samouraiworld/memba/backend/internal/service"
)

type fakeTokenAddressValidator struct {
	addr string
	err  error
	seen []string
}

func (f *fakeTokenAddressValidator) ValidateRESTTokenAddress(tokenJSON string) (string, error) {
	f.seen = append(f.seen, tokenJSON)
	return f.addr, f.err
}

// requireAuthAddressMiddleware authenticates like requireAuthMiddleware and also
// hands the token's wallet address to the handler through the request context,
// so handlers never have to trust an address supplied in the request body.
func TestRequireAuthAddressMiddleware(t *testing.T) {
	const wallet = "g1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

	t.Run("missing or non-bearer header is 401", func(t *testing.T) {
		for _, header := range []string{"", "Basic abc"} {
			v := &fakeTokenAddressValidator{addr: wallet}
			called := false
			next := http.HandlerFunc(func(http.ResponseWriter, *http.Request) { called = true })
			r := httptest.NewRequest(http.MethodPost, "/api/analyst/consensus", nil)
			if header != "" {
				r.Header.Set("Authorization", header)
			}
			rr := httptest.NewRecorder()
			requireAuthAddressMiddleware(v, next).ServeHTTP(rr, r)
			if rr.Code != http.StatusUnauthorized || called {
				t.Fatalf("header %q: want 401 and no handler call, got %d called=%v", header, rr.Code, called)
			}
		}
	})

	t.Run("invalid token is 401", func(t *testing.T) {
		v := &fakeTokenAddressValidator{err: errors.New("token expired")}
		called := false
		next := http.HandlerFunc(func(http.ResponseWriter, *http.Request) { called = true })
		r := httptest.NewRequest(http.MethodPost, "/api/analyst/consensus", nil)
		r.Header.Set("Authorization", "Bearer {}")
		rr := httptest.NewRecorder()
		requireAuthAddressMiddleware(v, next).ServeHTTP(rr, r)
		if rr.Code != http.StatusUnauthorized || called {
			t.Fatalf("want 401 and no handler call, got %d called=%v", rr.Code, called)
		}
	})

	t.Run("empty address from a valid token is 401", func(t *testing.T) {
		v := &fakeTokenAddressValidator{addr: ""}
		called := false
		next := http.HandlerFunc(func(http.ResponseWriter, *http.Request) { called = true })
		r := httptest.NewRequest(http.MethodPost, "/api/analyst/consensus", nil)
		r.Header.Set("Authorization", "Bearer {}")
		rr := httptest.NewRecorder()
		requireAuthAddressMiddleware(v, next).ServeHTTP(rr, r)
		if rr.Code != http.StatusUnauthorized || called {
			t.Fatalf("want 401 and no handler call, got %d called=%v", rr.Code, called)
		}
	})

	t.Run("valid token exposes the authenticated address", func(t *testing.T) {
		v := &fakeTokenAddressValidator{addr: wallet}
		var got string
		var ok bool
		next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			got, ok = service.AuthAddressFrom(r.Context())
			w.WriteHeader(http.StatusOK)
		})
		r := httptest.NewRequest(http.MethodPost, "/api/analyst/consensus", nil)
		r.Header.Set("Authorization", "Bearer {\"token\":1}")
		rr := httptest.NewRecorder()
		requireAuthAddressMiddleware(v, next).ServeHTTP(rr, r)
		if rr.Code != http.StatusOK {
			t.Fatalf("want 200, got %d", rr.Code)
		}
		if !ok || got != wallet {
			t.Fatalf("authenticated address not in context: got %q ok=%v", got, ok)
		}
		if len(v.seen) != 1 || v.seen[0] != "{\"token\":1}" {
			t.Fatalf("validator must receive the bearer payload, got %v", v.seen)
		}
	})
}
