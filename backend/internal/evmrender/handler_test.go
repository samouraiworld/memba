package evmrender

import (
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
)

// identityMiddleware is a no-op wrapper for tests. In production the caller passes the
// repo's rateLimit/auth middleware; RegisterRoutes forces a wrapper so a route can never be
// registered bare (A-8).
func identityMiddleware(_ string, h http.Handler) http.Handler { return h }

func TestHandler_Health(t *testing.T) {
	// No real EvmReader needed for health check
	h := New(nil, slog.Default())

	mux := http.NewServeMux()
	h.RegisterRoutes(mux, identityMiddleware)

	req := httptest.NewRequest("GET", "/api/evm/health", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		body, _ := io.ReadAll(rec.Body)
		t.Fatalf("expected 200, got %d: %s", rec.Code, body)
	}

	body := rec.Body.String()
	if body == "" || body == "null\n" {
		t.Fatal("expected JSON body, got empty")
	}
}

func TestHandler_MissingParams(t *testing.T) {
	h := New(nil, slog.Default())
	mux := http.NewServeMux()
	h.RegisterRoutes(mux, identityMiddleware)

	tests := []struct {
		path string
		code int
	}{
		{"/api/evm/native/balance/", http.StatusNotFound},
	}

	for _, tc := range tests {
		req := httptest.NewRequest("GET", tc.path, nil)
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)
		if rec.Code != tc.code {
			t.Errorf("GET %s: expected %d, got %d", tc.path, tc.code, rec.Code)
		}
	}
}

// A-8: invalid addresses must be rejected with 400 BEFORE any contract read. Previously the
// handlers passed the raw path value straight to common.HexToAddress, which never errors and
// silently crops an over-long hex string to a valid-looking address (address aliasing). The
// reader is nil here: a 400 proves validation happens before the read (a panic/502 would mean
// it did not).
func TestHandler_RejectsInvalidAddresses(t *testing.T) {
	h := New(nil, slog.Default())
	mux := http.NewServeMux()
	h.RegisterRoutes(mux, identityMiddleware)

	// 64 hex chars — not a 20-byte address; the old code cropped it silently.
	longHex := "0x" + "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"
	bad := "0xnothex"

	paths := []string{
		"/api/evm/dao/" + longHex + "/members",
		"/api/evm/dao/" + bad + "/members",
		"/api/evm/dao/0xdeadbeef00000000000000000000000000000000/member/" + bad,
		"/api/evm/token/" + bad + "/balance/0xdeadbeef00000000000000000000000000000000",
		"/api/evm/native/balance/" + longHex,
	}

	for _, p := range paths {
		req := httptest.NewRequest("GET", p, nil)
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)
		if rec.Code != http.StatusBadRequest {
			body, _ := io.ReadAll(rec.Body)
			t.Errorf("GET %s: expected 400, got %d: %s", p, rec.Code, body)
		}
	}
}
