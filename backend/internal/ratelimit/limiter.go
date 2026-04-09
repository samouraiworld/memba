package ratelimit

import (
	"context"
	"net"
	"strings"
	"sync"
	"time"
)

// Config defines per-endpoint rate limiting parameters.
type Config struct {
	// MaxRequests is the maximum number of requests allowed per window.
	MaxRequests int
	// Window is the duration of the rate limit window.
	Window time.Duration
}

// DefaultConfigs returns sensible per-endpoint rate limits.
// Key convention: HTTP method + path prefix (e.g., "GET /api/render").
func DefaultConfigs() map[string]Config {
	return map[string]Config{
		"render": {MaxRequests: 30, Window: time.Minute},  // SPA makes 3-6 ABCI calls on page load
		"eval":   {MaxRequests: 10, Window: time.Minute},  // Eval is heavier
		"balance": {MaxRequests: 20, Window: time.Minute}, // Balance check
		"rpc":    {MaxRequests: 60, Window: time.Minute},  // ConnectRPC (all service calls combined)
		"tx":     {MaxRequests: 10, Window: time.Minute},  // Sign/Complete transaction — stricter
		"oauth":   {MaxRequests: 5, Window: time.Minute},   // OAuth flows — strict
		"analyst": {MaxRequests: 10, Window: time.Minute},  // DAO analyst — LLM calls are expensive
		"default": {MaxRequests: 100, Window: time.Minute}, // Fallback for unknown endpoints
	}
}

// entry holds the counter and expiry for a single IP+endpoint pair.
type entry struct {
	count  int
	expiry time.Time
}

// Limiter provides per-endpoint, per-IP rate limiting with /24 subnet bucketing.
type Limiter struct {
	mu      sync.Mutex
	entries map[string]*entry // key: "subnet:endpoint"
	configs map[string]Config
}

// New creates a new Limiter. The GC goroutine runs until ctx is cancelled.
func New(ctx context.Context, configs map[string]Config) *Limiter {
	if configs == nil {
		configs = DefaultConfigs()
	}
	l := &Limiter{
		entries: make(map[string]*entry),
		configs: configs,
	}
	go l.gc(ctx)
	return l
}

// Allow checks whether a request from the given IP to the given endpoint is allowed.
// endpoint should match a key in the configs map (e.g., "render", "eval", "rpc").
func (l *Limiter) Allow(ip, endpoint string) bool {
	subnet := subnetKey(ip)
	key := subnet + ":" + endpoint

	cfg, ok := l.configs[endpoint]
	if !ok {
		cfg = l.configs["default"]
	}

	l.mu.Lock()
	defer l.mu.Unlock()

	now := time.Now()
	e, ok := l.entries[key]
	if !ok || now.After(e.expiry) {
		l.entries[key] = &entry{count: 1, expiry: now.Add(cfg.Window)}
		return true
	}
	e.count++
	return e.count <= cfg.MaxRequests
}

// gc cleans up expired entries every minute.
func (l *Limiter) gc(ctx context.Context) {
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			l.mu.Lock()
			now := time.Now()
			for k, e := range l.entries {
				if now.After(e.expiry) {
					delete(l.entries, k)
				}
			}
			l.mu.Unlock()
		}
	}
}

// subnetKey extracts the /24 subnet from an IP address.
// For IPv4: "1.2.3.4" → "1.2.3.0/24"
// For IPv6 or unparseable: returns the raw string (no bucketing).
func subnetKey(ip string) string {
	// Strip port if present (e.g., "1.2.3.4:12345")
	if host, _, err := net.SplitHostPort(ip); err == nil {
		ip = host
	}
	parsed := net.ParseIP(ip)
	if parsed == nil {
		return ip
	}
	// IPv4 /24 bucketing
	if v4 := parsed.To4(); v4 != nil {
		return net.IPv4(v4[0], v4[1], v4[2], 0).String() + "/24"
	}
	// IPv6: use /48 bucketing (common ISP allocation)
	if len(parsed) == net.IPv6len {
		mask := net.CIDRMask(48, 128)
		return parsed.Mask(mask).String() + "/48"
	}
	return ip
}

// ExtractIP extracts the client IP from an HTTP request,
// using X-Forwarded-For if available (first entry, trimmed).
func ExtractIP(remoteAddr, xForwardedFor string) string {
	if xForwardedFor != "" {
		parts := strings.Split(xForwardedFor, ",")
		return strings.TrimSpace(parts[0])
	}
	return strings.TrimSpace(remoteAddr)
}
