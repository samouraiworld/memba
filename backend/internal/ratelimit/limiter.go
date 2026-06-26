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
		"render": {MaxRequests: 30, Window: time.Minute}, // SPA makes 3-6 ABCI calls on page load
		// "eval" removed in v6 (SEC-01) — /api/eval endpoint was removed
		"balance":        {MaxRequests: 20, Window: time.Minute},  // Balance check
		"rpc":            {MaxRequests: 60, Window: time.Minute},  // ConnectRPC (all service calls combined)
		"tx":             {MaxRequests: 10, Window: time.Minute},  // Sign/Complete transaction — stricter
		"oauth":          {MaxRequests: 5, Window: time.Minute},   // OAuth flows — strict
		"analyst":        {MaxRequests: 10, Window: time.Minute},  // DAO analyst — LLM calls are expensive
		"upload":         {MaxRequests: 5, Window: time.Minute},   // IPFS avatar upload — strict
		"nft":            {MaxRequests: 60, Window: time.Minute},  // NFT image/metadata proxy — cacheable reads
		"marketplace":    {MaxRequests: 30, Window: time.Minute},  // Marketplace agents/escrow render
		"token_launches": {MaxRequests: 60, Window: time.Minute},  // cached token launch-date map (read)
		"default":        {MaxRequests: 100, Window: time.Minute}, // Fallback for unknown endpoints
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

// ExtractIP extracts the client IP from an HTTP request.
//
// Trust model (finding S-F2): proxy-supplied client-IP headers (Fly-Client-IP,
// X-Forwarded-For) are only honored when trustProxy is true — i.e. the request
// is known to have arrived through our trusted reverse proxy (the Fly.io edge,
// which sets Fly-Client-IP and appends its own X-Forwarded-For entry). The
// caller decides trust from the deployment context (see the TRUSTED_PROXY /
// FLY_APP_NAME signal in cmd/memba), NOT from anything the client can set.
//
// When trustProxy is false (e.g. the backend is reached directly, off the Fly
// edge), these headers are attacker-controlled and MUST be ignored — otherwise
// a client could spoof Fly-Client-IP or X-Forwarded-For to rotate its per-IP
// rate-limit bucket and evade limits on unauthenticated endpoints. In that case
// the only trustworthy source is the connection's RemoteAddr.
//
// Even when trusted, the FIRST X-Forwarded-For entry is the original client
// value and is never used; behind Fly.io the LAST entry is the proxy-added one.
func ExtractIP(trustProxy bool, remoteAddr, xForwardedFor string, headers ...string) string {
	if trustProxy {
		// 1. Fly-Client-IP — set by the Fly.io proxy, not client-spoofable here.
		for _, h := range headers {
			if h != "" {
				return strings.TrimSpace(h)
			}
		}

		// 2. Last X-Forwarded-For entry — appended by the trusted reverse proxy.
		if xForwardedFor != "" {
			parts := strings.Split(xForwardedFor, ",")
			return strings.TrimSpace(parts[len(parts)-1])
		}
	}

	// 3. Direct connection (and the only trusted source when trustProxy=false).
	// Strip the port so the rate-limit key is the host, not host:ephemeral-port.
	remoteAddr = strings.TrimSpace(remoteAddr)
	if host, _, err := net.SplitHostPort(remoteAddr); err == nil {
		return host
	}
	return remoteAddr
}
