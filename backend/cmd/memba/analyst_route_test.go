package main

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/samouraiworld/memba/backend/internal/service"
)

// The analyst consensus route refuses everything while ANALYST_ENABLED is
// unset, before any token is looked at; when enabled it accepts either the
// analyst admin bearer or a wallet token, and passes that identity on.
func TestAnalystConsensusHandler(t *testing.T) {
	const wallet = "g1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	type seen struct {
		called bool
		admin  bool
		addr   string
	}
	run := func(t *testing.T, authHeader string, v *fakeTokenAddressValidator) (int, seen) {
		t.Helper()
		var s seen
		next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			s.called = true
			s.addr, _ = service.AuthAddressFrom(r.Context())
			s.admin = service.AnalystAdminFrom(r.Context())
			w.WriteHeader(http.StatusOK)
		})
		r := httptest.NewRequest(http.MethodPost, "/api/analyst/consensus", nil)
		if authHeader != "" {
			r.Header.Set("Authorization", authHeader)
		}
		rec := httptest.NewRecorder()
		analystConsensusHandler(v, next).ServeHTTP(rec, r)
		return rec.Code, s
	}

	t.Run("disabled when ANALYST_ENABLED is unset", func(t *testing.T) {
		t.Setenv("ANALYST_ENABLED", "")
		t.Setenv("ANALYST_ADMIN_BEARER", "admin-secret")
		for _, h := range []string{"", "Bearer {}", "Bearer admin-secret"} {
			v := &fakeTokenAddressValidator{addr: wallet}
			code, s := run(t, h, v)
			if code != http.StatusServiceUnavailable || s.called || len(v.seen) != 0 {
				t.Fatalf("header %q: got %d called=%v validator calls=%d", h, code, s.called, len(v.seen))
			}
		}
	})

	t.Run("enabled without credentials is 401", func(t *testing.T) {
		t.Setenv("ANALYST_ENABLED", "true")
		t.Setenv("ANALYST_ADMIN_BEARER", "admin-secret")
		code, s := run(t, "", &fakeTokenAddressValidator{addr: wallet})
		if code != http.StatusUnauthorized || s.called {
			t.Fatalf("got %d called=%v", code, s.called)
		}
	})

	t.Run("enabled with a wallet token passes the address", func(t *testing.T) {
		t.Setenv("ANALYST_ENABLED", "true")
		t.Setenv("ANALYST_ADMIN_BEARER", "admin-secret")
		code, s := run(t, "Bearer {\"token\":1}", &fakeTokenAddressValidator{addr: wallet})
		if code != http.StatusOK || !s.called || s.addr != wallet || s.admin {
			t.Fatalf("got %d called=%v addr=%q", code, s.called, s.addr)
		}
	})

	t.Run("enabled with the admin bearer skips wallet auth", func(t *testing.T) {
		t.Setenv("ANALYST_ENABLED", "true")
		t.Setenv("ANALYST_ADMIN_BEARER", "admin-secret")
		v := &fakeTokenAddressValidator{addr: wallet}
		code, s := run(t, "Bearer admin-secret", v)
		if code != http.StatusOK || !s.called || !s.admin || s.addr != "" || len(v.seen) != 0 {
			t.Fatalf("got %d called=%v admin=%v validator calls=%d", code, s.called, s.admin, len(v.seen))
		}
	})
}
