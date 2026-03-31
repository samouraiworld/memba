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
		{"1.2.3.4:8080", "1.2.3.0/24"},   // With port
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

func TestExtractIP(t *testing.T) {
	tests := []struct {
		remote, xff, want string
	}{
		{"1.2.3.4:55555", "", "1.2.3.4:55555"},
		{"1.2.3.4:55555", "5.6.7.8", "5.6.7.8"},
		{"1.2.3.4:55555", "5.6.7.8, 9.10.11.12", "5.6.7.8"},
		{"1.2.3.4:55555", " 5.6.7.8 , 9.10.11.12 ", "5.6.7.8"},
	}
	for _, tt := range tests {
		got := ExtractIP(tt.remote, tt.xff)
		if got != tt.want {
			t.Errorf("ExtractIP(%q, %q) = %q, want %q", tt.remote, tt.xff, got, tt.want)
		}
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
