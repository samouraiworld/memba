package main

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

func TestArcadeFreePlayLimiterBoundsAndCleanup(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	l, err := newArcadeFreePlayLimiter(ctx, arcadeFreePlayLimits{IPRequests: 2, WalletRequests: 1, MaxEntries: 2, Window: time.Hour})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { cancel(); <-l.done }()
	var clock atomic.Int64
	clock.Store(1000)
	l.mu.Lock()
	l.now = func() time.Time { return time.Unix(clock.Load(), 0) }
	l.mu.Unlock()
	checked := context.WithValue(ctx, arcadeFreePlayIPChecked{}, true)
	if l.AllowFreePlay(ctx, "wallet", "") {
		t.Fatal("bypassed IP middleware")
	}
	if !l.allow(ctx, "ip:one", 2) || !l.AllowFreePlay(checked, "wallet", "") || l.AllowFreePlay(checked, "wallet", "") {
		t.Fatal("wallet quota not enforced")
	}
	for i := 0; i < 100; i++ {
		if l.allow(ctx, fmt.Sprintf("ip:%d", i), 2) {
			t.Fatal("active capacity evicted")
		}
	}
	l.mu.Lock()
	entries := len(l.entries)
	l.mu.Unlock()
	if entries != 2 {
		t.Fatal("unbounded entries")
	}
	clock.Add(3601)
	if !l.allow(ctx, "ip:new", 2) {
		t.Fatal("expired capacity not reclaimed")
	}
	l.mu.Lock()
	entries = len(l.entries)
	l.mu.Unlock()
	if entries != 1 {
		t.Fatal("expired entries retained")
	}
	cancel()
	if l.allow(ctx, "ip:cancelled", 2) {
		t.Fatal("cancelled request admitted")
	}
}
func TestArcadeFreePlayLimiterStopsIPBeforeAuthAndHonorsProxyPolicy(t *testing.T) {
	before := trustProxy
	trustProxy = false
	defer func() { trustProxy = before }()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	l, err := newArcadeFreePlayLimiter(ctx, arcadeFreePlayLimits{IPRequests: 1, WalletRequests: 1, MaxEntries: 8, Window: time.Hour})
	if err != nil {
		t.Fatal(err)
	}
	calls := 0
	handler := l.wrap(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if !l.AllowFreePlay(r.Context(), "", r.RemoteAddr) {
			t.Error("public request missed IP marker")
		}
		w.WriteHeader(204)
	}))
	for i := 0; i < 2; i++ {
		r := httptest.NewRequest("GET", "/", nil)
		r.RemoteAddr = "192.0.2.1:123"
		r.Header.Set("X-Forwarded-For", fmt.Sprintf("198.51.100.%d", i))
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		want := 204
		if i == 1 {
			want = 429
		}
		if w.Code != want {
			t.Fatalf("status=%d want=%d", w.Code, want)
		}
	}
	if calls != 1 {
		t.Fatal("rejected IP reached authentication")
	}
	trustProxy = true
	r := httptest.NewRequest("GET", "/", nil)
	r.RemoteAddr = "192.0.2.1:123"
	r.Header.Set("Fly-Client-IP", "198.51.100.10")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)
	if w.Code != 204 {
		t.Fatal("trusted proxy policy not reused")
	}
	cancel()
	<-l.done
}
func TestArcadeFreePlayLimiterPeriodicCleanupAndMissingConfig(t *testing.T) {
	if _, err := newArcadeFreePlayLimiter(context.Background(), arcadeFreePlayLimits{}); err == nil {
		t.Fatal("missing explicit caps accepted")
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	l, err := newArcadeFreePlayLimiter(ctx, arcadeFreePlayLimits{1, 1, 2, 5 * time.Millisecond})
	if err != nil {
		t.Fatal(err)
	}
	if !l.allow(ctx, "ip:one", 1) {
		t.Fatal("first request refused")
	}
	deadline := time.After(time.Second)
	ticker := time.NewTicker(5 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case <-deadline:
			t.Fatal("cleanup did not reclaim expired memory")
		case <-ticker.C:
			l.mu.Lock()
			n := len(l.entries)
			l.mu.Unlock()
			if n == 0 {
				cancel()
				<-l.done
				return
			}
		}
	}
}
