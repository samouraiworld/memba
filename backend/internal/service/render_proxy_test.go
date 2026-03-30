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

func TestHandleEvalProxy_MissingParams(t *testing.T) {
	handler := HandleEvalProxy()

	// Missing both
	req := httptest.NewRequest(http.MethodGet, "/api/eval", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", rec.Code)
	}

	// Missing expr
	req = httptest.NewRequest(http.MethodGet, "/api/eval?realm=gno.land/r/test", nil)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for missing expr, got %d", rec.Code)
	}
}

func TestHandleEvalProxy_InvalidRealm(t *testing.T) {
	handler := HandleEvalProxy()
	req := httptest.NewRequest(http.MethodGet, "/api/eval?realm=evil.com&expr=Foo()", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", rec.Code)
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
