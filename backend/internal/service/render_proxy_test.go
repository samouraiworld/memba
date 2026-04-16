package service

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHandleRenderProxy_MissingRealm(t *testing.T) {
	handler := HandleRenderProxy()
	req := httptest.NewRequest(http.MethodGet, "/api/render", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", rec.Code)
	}
}

func TestHandleRenderProxy_InvalidRealm(t *testing.T) {
	handler := HandleRenderProxy()
	req := httptest.NewRequest(http.MethodGet, "/api/render?realm=evil.com/hack", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", rec.Code)
	}
}

func TestHandleRenderProxy_MethodNotAllowed(t *testing.T) {
	handler := HandleRenderProxy()
	req := httptest.NewRequest(http.MethodPost, "/api/render?realm=gno.land/r/gov/dao", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("expected 405, got %d", rec.Code)
	}
}

// HandleEvalProxy tests removed — endpoint removed in v6 (SEC-01).

func TestHandleRenderProxy_InvalidPathChars(t *testing.T) {
	handler := HandleRenderProxy()
	// Path with quotes should be rejected
	req := httptest.NewRequest(http.MethodGet, `/api/render?realm=gno.land/r/test&path=foo"bar`, nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for path with quotes, got %d", rec.Code)
	}
}

func TestHandleRenderProxy_ValidPath(t *testing.T) {
	handler := HandleRenderProxy()
	// Path with colons (for pagination: page:1) should be accepted
	req := httptest.NewRequest(http.MethodGet, "/api/render?realm=gno.land/r/test&path=page:1", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	// Will fail with 502 (no RPC) but should NOT be 400
	if rec.Code == http.StatusBadRequest {
		t.Errorf("path with colons should be accepted, got 400")
	}
}

func TestHandleBalanceProxy_MissingAddress(t *testing.T) {
	handler := HandleBalanceProxy()
	req := httptest.NewRequest(http.MethodGet, "/api/balance", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", rec.Code)
	}
}

func TestHandleBalanceProxy_InvalidAddress(t *testing.T) {
	handler := HandleBalanceProxy()

	// Too short
	req := httptest.NewRequest(http.MethodGet, "/api/balance?address=g1short", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for short address, got %d", rec.Code)
	}

	// Wrong prefix
	req = httptest.NewRequest(http.MethodGet, "/api/balance?address=cosmos1abcdefghijklmnopqrstuvwxyz12345678", nil)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for wrong prefix, got %d", rec.Code)
	}
}
