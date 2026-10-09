package main

import (
	"context"
	"net/http"
	"sync"
	"time"

	"github.com/samouraiworld/memba/backend/internal/arcade"
	"github.com/samouraiworld/memba/backend/internal/ratelimit"
)

type arcadeFreePlayLimits struct {
	IPRequests, WalletRequests, MaxEntries int
	Window                                 time.Duration
}
type arcadeFreePlayLimitEntry struct {
	used    int
	expires time.Time
}
type arcadeFreePlayIPChecked struct{}
type arcadeFreePlayLimiter struct {
	mu      sync.Mutex
	config  arcadeFreePlayLimits
	entries map[string]arcadeFreePlayLimitEntry
	now     func() time.Time
	done    chan struct{}
}

func newArcadeFreePlayLimiter(ctx context.Context, cfg arcadeFreePlayLimits) (*arcadeFreePlayLimiter, error) {
	if ctx == nil || cfg.IPRequests <= 0 || cfg.WalletRequests <= 0 || cfg.MaxEntries < 2 || cfg.Window <= 0 {
		return nil, arcade.ErrFreePlayPaused
	}
	l := &arcadeFreePlayLimiter{config: cfg, entries: make(map[string]arcadeFreePlayLimitEntry), now: time.Now, done: make(chan struct{})}
	go func() {
		defer close(l.done)
		ticker := time.NewTicker(cfg.Window)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				l.mu.Lock()
				l.prune(l.now())
				l.mu.Unlock()
			}
		}
	}()
	return l, nil
}
func (l *arcadeFreePlayLimiter) prune(now time.Time) {
	for key, value := range l.entries {
		if !value.expires.After(now) {
			delete(l.entries, key)
		}
	}
}
func (l *arcadeFreePlayLimiter) allow(ctx context.Context, key string, maximum int) bool {
	if ctx.Err() != nil || key == "" || len(key) > 256 {
		return false
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()
	value, found := l.entries[key]
	if found && !value.expires.After(now) {
		delete(l.entries, key)
		found = false
	}
	if !found {
		if len(l.entries) >= l.config.MaxEntries {
			l.prune(now)
		}
		if len(l.entries) >= l.config.MaxEntries {
			return false
		} // Never evict active limits to admit new identities.
		value = arcadeFreePlayLimitEntry{expires: now.Add(l.config.Window)}
	}
	if value.used >= maximum {
		return false
	}
	value.used++
	l.entries[key] = value
	return true
}

// IP applies before token parsing, including public boards and rejected auth.
// The marker is private to this middleware; no request header can supply it.
func (l *arcadeFreePlayLimiter) wrap(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ip := ratelimit.ExtractIP(trustProxy, r.RemoteAddr, r.Header.Get("X-Forwarded-For"), r.Header.Get("Fly-Client-IP"))
		if ip == "" || !l.allow(r.Context(), "ip:"+ip, l.config.IPRequests) {
			http.Error(w, "quota_exceeded", http.StatusTooManyRequests)
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), arcadeFreePlayIPChecked{}, true)))
	})
}
func (l *arcadeFreePlayLimiter) AllowFreePlay(ctx context.Context, player, _ string) bool {
	if ctx.Err() != nil || ctx.Value(arcadeFreePlayIPChecked{}) != true {
		return false
	}
	if player == "" {
		return true
	}
	return l.allow(ctx, "wallet:"+player, l.config.WalletRequests)
}
