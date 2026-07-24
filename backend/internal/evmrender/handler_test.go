package evmrender

import (
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHandler_Health(t *testing.T) {
	// No real EvmReader needed for health check
	h := New(nil, slog.Default())

	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

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
	h.RegisterRoutes(mux)

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
