package ratelimit

import (
	"context"
	"testing"
	"time"
)

func TestSubnetKey_IPv4(t *testing.T) {
	tests := []struct {
		ip   string
		want string
	}{
		{"1.2.3.4", "1.2.3.0/24"},
		{"192.168.1.100", "192.168.1.0/24"},
		{"10.0.0.1", "10.0.0.0/24"},
		{"1.2.3.4:8080", "1.2.3.0/24"}, // With port
	}
	for _, tt := range tests {
		got := subnetKey(tt.ip)
		if got != tt.want {
			t.Errorf("subnetKey(%q) = %q, want %q", tt.ip, got, tt.want)
		}
	}
}

func TestSubnetKey_IPv6(t *testing.T) {
	got := subnetKey("2001:db8:1234:5678::1")
	// /48 mask should zero out bytes 7+ of the address
	if got == "" {
		t.Error("subnetKey returned empty for IPv6")
	}
	if got == "2001:db8:1234:5678::1" {
		t.Error("subnetKey should bucket IPv6, not return raw")
	}
}

func TestSubnetKey_Unparseable(t *testing.T) {
	got := subnetKey("not-an-ip")
	if got != "not-an-ip" {
		t.Errorf("subnetKey should return raw for unparseable, got %q", got)
	}
}

// TestExtractIP_TrustedProxy covers the production deployment model: the
// backend runs behind the Fly.io edge proxy (trustProxy=true), which sets
// Fly-Client-IP and appends its own X-Forwarded-For entry. Proxy-supplied
// headers must be honored here so per-IP rate limiting still works in prod.
func TestExtractIP_TrustedProxy(t *testing.T) {
	tests := []struct {
		name        string
		remote, xff string
		flyClientIP string
		want        string
	}{
		// No proxy headers: fall through to RemoteAddr, port stripped
		// (subnetKey strips it downstream anyway, so the bucket is unchanged).
		{"remote only", "1.2.3.4:55555", "", "", "1.2.3.4"},
		{"xff single", "1.2.3.4:55555", "5.6.7.8", "", "5.6.7.8"},
		// Last XFF entry (proxy-added), not first (attacker-controlled)
		{"xff multi uses last", "1.2.3.4:55555", "5.6.7.8, 9.10.11.12", "", "9.10.11.12"},
		{"xff multi trimmed", "1.2.3.4:55555", " 5.6.7.8 , 9.10.11.12 ", "", "9.10.11.12"},
		// Fly-Client-IP takes priority over XFF
		{"fly-client-ip priority", "1.2.3.4:55555", "5.6.7.8", "99.99.99.99", "99.99.99.99"},
		// Spoofed XFF with Fly-Client-IP present — Fly-Client-IP wins
		{"spoofed xff ignored", "1.2.3.4:55555", "spoofed.ip, real.proxy", "99.99.99.99", "99.99.99.99"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var headers []string
			if tt.flyClientIP != "" {
				headers = append(headers, tt.flyClientIP)
			}
			got := ExtractIP(true, tt.remote, tt.xff, headers...)
			if got != tt.want {
				t.Errorf("ExtractIP(true, %q, %q, %v) = %q, want %q", tt.remote, tt.xff, headers, got, tt.want)
			}
		})
	}
}

// TestExtractIP_UntrustedProxy is the security regression test for finding
// S-F2: when the request did NOT arrive through the trusted proxy
// (trustProxy=false), client-settable headers (Fly-Client-IP, X-Forwarded-For)
// are attacker-controlled and MUST be ignored. The connection's RemoteAddr
// (host portion) is the only trustworthy source, so spoofing the headers must
// not let an attacker rotate their rate-limit bucket.
func TestExtractIP_UntrustedProxy(t *testing.T) {
	tests := []struct {
		name        string
		remote, xff string
		flyClientIP string
		want        string
	}{
		// No spoofing — plain connection.
		{"remote only", "1.2.3.4:55555", "", "", "1.2.3.4"},
		// Spoofed Fly-Client-IP must be ignored; fall back to RemoteAddr host.
		{"spoofed fly-client-ip ignored", "1.2.3.4:55555", "", "99.99.99.99", "1.2.3.4"},
		// Spoofed X-Forwarded-For must be ignored; fall back to RemoteAddr host.
		{"spoofed xff ignored", "1.2.3.4:55555", "5.6.7.8, 9.10.11.12", "", "1.2.3.4"},
		// Both spoofed — still the real RemoteAddr host.
		{"both spoofed ignored", "1.2.3.4:55555", "5.6.7.8", "99.99.99.99", "1.2.3.4"},
		// RemoteAddr without a port (defensive) — returned as-is.
		{"remote no port", "1.2.3.4", "", "99.99.99.99", "1.2.3.4"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var headers []string
			if tt.flyClientIP != "" {
				headers = append(headers, tt.flyClientIP)
			}
			got := ExtractIP(false, tt.remote, tt.xff, headers...)
			if got != tt.want {
				t.Errorf("ExtractIP(false, %q, %q, %v) = %q, want %q", tt.remote, tt.xff, headers, got, tt.want)
			}
		})
	}
}

func TestLimiter_Allow_WithinLimit(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	configs := map[string]Config{
		"test":    {MaxRequests: 3, Window: time.Minute},
		"default": {MaxRequests: 100, Window: time.Minute},
	}
	l := New(ctx, configs)

	if !l.Allow("1.2.3.4", "test") {
		t.Error("first request should be allowed")
	}
	if !l.Allow("1.2.3.4", "test") {
		t.Error("second request should be allowed")
	}
	if !l.Allow("1.2.3.4", "test") {
		t.Error("third request should be allowed")
	}
}

func TestLimiter_Allow_ExceedsLimit(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	configs := map[string]Config{
		"strict":  {MaxRequests: 2, Window: time.Minute},
		"default": {MaxRequests: 100, Window: time.Minute},
	}
	l := New(ctx, configs)

	l.Allow("1.2.3.4", "strict")
	l.Allow("1.2.3.4", "strict")
	if l.Allow("1.2.3.4", "strict") {
		t.Error("third request should be rate limited")
	}
}

func TestLimiter_SubnetBucketing(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	configs := map[string]Config{
		"test":    {MaxRequests: 2, Window: time.Minute},
		"default": {MaxRequests: 100, Window: time.Minute},
	}
	l := New(ctx, configs)

	// Same /24 subnet should share the limit
	l.Allow("10.0.1.10", "test")
	l.Allow("10.0.1.20", "test") // Same subnet
	if l.Allow("10.0.1.30", "test") {
		t.Error("same /24 subnet should share rate limit")
	}

	// Different /24 subnet should have its own limit
	if !l.Allow("10.0.2.10", "test") {
		t.Error("different /24 subnet should have its own limit")
	}
}

func TestLimiter_DifferentEndpoints(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	configs := map[string]Config{
		"a":       {MaxRequests: 1, Window: time.Minute},
		"b":       {MaxRequests: 1, Window: time.Minute},
		"default": {MaxRequests: 100, Window: time.Minute},
	}
	l := New(ctx, configs)

	l.Allow("1.2.3.4", "a")
	if l.Allow("1.2.3.4", "a") {
		t.Error("endpoint 'a' should be limited")
	}
	// Endpoint 'b' should still have its own budget
	if !l.Allow("1.2.3.4", "b") {
		t.Error("endpoint 'b' should still be available")
	}
}

func TestLimiter_FallbackToDefault(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	configs := map[string]Config{
		"default": {MaxRequests: 2, Window: time.Minute},
	}
	l := New(ctx, configs)

	l.Allow("1.2.3.4", "unknown-endpoint")
	l.Allow("1.2.3.4", "unknown-endpoint")
	if l.Allow("1.2.3.4", "unknown-endpoint") {
		t.Error("unknown endpoint should use default limit")
	}
}

func TestLimiter_WindowExpiry(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	configs := map[string]Config{
		"fast":    {MaxRequests: 1, Window: 50 * time.Millisecond},
		"default": {MaxRequests: 100, Window: time.Minute},
	}
	l := New(ctx, configs)

	l.Allow("1.2.3.4", "fast")
	if l.Allow("1.2.3.4", "fast") {
		t.Error("should be limited before window expires")
	}

	// Wait for window to expire
	time.Sleep(60 * time.Millisecond)

	if !l.Allow("1.2.3.4", "fast") {
		t.Error("should be allowed after window expires")
	}
}

func TestLimiter_AllowKey_Isolation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	l := New(ctx, map[string]Config{"quest_write": {MaxRequests: 2, Window: time.Minute}})

	// Two distinct keys (e.g. wallet addresses) get independent buckets.
	first := l.AllowKey("g1alice", "quest_write")
	second := l.AllowKey("g1alice", "quest_write")
	if !first || !second {
		t.Fatal("first two calls for alice should pass")
	}
	if l.AllowKey("g1alice", "quest_write") {
		t.Error("third call for alice should be limited")
	}
	if !l.AllowKey("g1bob", "quest_write") {
		t.Error("bob has his own bucket and should pass")
	}
}

func TestLimiter_AllowKey_NoSubnetBucketing(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	l := New(ctx, map[string]Config{"k": {MaxRequests: 1, Window: time.Minute}})

	// Unlike Allow (which /24-buckets IPs), AllowKey uses the key verbatim, so two
	// addresses that would share a /24 if treated as IPs do NOT share a bucket.
	if !l.AllowKey("1.2.3.4", "k") {
		t.Fatal("first key should pass")
	}
	if !l.AllowKey("1.2.3.5", "k") {
		t.Error("a different verbatim key must not share the bucket")
	}
}

func TestPerUserQuestConfigs_DefaultsAndOverride(t *testing.T) {
	def := PerUserQuestConfigs(nil)
	if def[QuestWriteEndpoint].MaxRequests != 10 || def[QuestClaimEndpoint].MaxRequests != 5 {
		t.Fatalf("unexpected defaults: %+v", def)
	}
	over := PerUserQuestConfigs(func(name string, d int) int {
		if name == "MEMBA_QUEST_WRITE_RPM" {
			return 3
		}
		return d
	})
	if over[QuestWriteEndpoint].MaxRequests != 3 || over[QuestClaimEndpoint].MaxRequests != 5 {
		t.Fatalf("env override not applied: %+v", over)
	}
}
