package main

import (
	"bytes"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/samouraiworld/memba/backend/internal/ratelimit"
	"github.com/samouraiworld/memba/backend/internal/service"
)

// The boot log names the chains and whether a key is set, never the key.
func TestSafeTxConfigNeverLogsTheKey(t *testing.T) {
	const key = "sk-live-do-not-print-0123456789"
	var buf bytes.Buffer
	prev := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&buf, nil)))
	t.Cleanup(func() { slog.SetDefault(prev) })

	env := map[string]string{service.SafeTxChainsEnv: "84532,1", service.SafeTxAPIKeyEnv: key}
	cfg := safeTxConfig(func(k string) string { return env[k] })
	if !cfg.Enabled() || !cfg.HasAPIKey() {
		t.Fatalf("want an enabled, keyed config")
	}
	out := buf.String()
	if strings.Contains(out, key) {
		t.Fatalf("the API key reached the log: %s", out)
	}
	if !strings.Contains(out, "84532") || !strings.Contains(out, "apiKeySet=true") || !strings.Contains(out, "skipped=[1]") {
		t.Fatalf("want the served chain, the key's presence and the skipped id logged, got: %s", out)
	}

	buf.Reset()
	if safeTxConfig(func(string) string { return "" }).Enabled() {
		t.Fatalf("unset env must leave the proxy off")
	}
	if !strings.Contains(buf.String(), "proxy OFF") {
		t.Fatalf("want the off state logged, got: %s", buf.String())
	}
}

// As mounted: one per-IP bucket for every call, and a stricter one for writes.
func TestSafeTxRouteRateLimits(t *testing.T) {
	prev := limiter
	limiter = ratelimit.New(t.Context(), map[string]ratelimit.Config{
		"safe_tx":       {MaxRequests: 3, Window: time.Minute},
		"safe_tx_write": {MaxRequests: 1, Window: time.Minute},
	})
	t.Cleanup(func() { limiter = prev })

	reached := 0
	route := rateLimitMiddleware("safe_tx", http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { reached++ }))
	call := func(method string) int {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(method, "/api/safe-tx/84532/v1/about", nil)
		req.RemoteAddr = "203.0.113.7:1234"
		route.ServeHTTP(rec, req)
		return rec.Code
	}
	if c := call(http.MethodPost); c != http.StatusOK {
		t.Fatalf("first write: got %d", c)
	}
	if c := call(http.MethodPost); c != http.StatusTooManyRequests {
		t.Fatalf("second write in a minute: got %d, want 429", c)
	}
	if c := call(http.MethodGet); c != http.StatusOK {
		t.Fatalf("a read after the write cap: got %d, want 200", c)
	}
	if c := call(http.MethodGet); c != http.StatusTooManyRequests {
		t.Fatalf("fourth call of the IP: got %d, want 429", c)
	}
	if reached != 2 {
		t.Fatalf("handler reached %d times, want 2", reached)
	}
}
