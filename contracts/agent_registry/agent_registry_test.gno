package agent_registry

import (
	"strings"
	"testing"
)

// ── Init ────────────────────────────────────────────────────

func TestInit(t *testing.T) {
	if agents == nil {
		t.Fatal("agents tree not initialized")
	}
	if reviews == nil {
		t.Fatal("reviews tree not initialized")
	}
	if credits == nil {
		t.Fatal("credits tree not initialized")
	}
	if usage == nil {
		t.Fatal("usage tree not initialized")
	}
}

// ── Render ───────────────────────────────────────────────────

func TestRenderHome_Empty(t *testing.T) {
	output := Render("")
	if !strings.Contains(output, "Memba Agent Registry") {
		t.Fatal("expected registry title")
	}
	if !strings.Contains(output, "No agents registered yet") {
		t.Fatal("expected empty state message")
	}
}

func TestRenderAgent_NotFound(t *testing.T) {
	output := Render("agent/nonexistent")
	if !strings.Contains(output, "404") {
		t.Fatal("expected 404 for missing agent")
	}
}

func TestRenderStats_Empty(t *testing.T) {
	output := Render("stats")
	if !strings.Contains(output, "Registry Stats") {
		t.Fatal("expected stats title")
	}
	if !strings.Contains(output, "Total Agents") {
		t.Fatal("expected total agents stat")
	}
}

func TestRender404(t *testing.T) {
	output := Render("unknown/path")
	if !strings.Contains(output, "404") {
		t.Fatal("expected 404 for unknown path")
	}
}

// ── Rating Formatting ───────────────────────────────────────

func TestFormatRating(t *testing.T) {
	tests := []struct {
		sum, count int64
		expected   string
	}{
		{5, 1, "5.0"},
		{9, 2, "4.5"},
		{14, 3, "4.6"},
		{0, 0, "0.0"},
		{25, 5, "5.0"},
		{3, 1, "3.0"},
		{7, 2, "3.5"},
		{10, 3, "3.3"},
	}

	for _, tt := range tests {
		got := formatRating(tt.sum, tt.count)
		if got != tt.expected {
			t.Fatalf("formatRating(%d, %d) = %s, want %s", tt.sum, tt.count, got, tt.expected)
		}
	}
}

// ── Credits & Usage (read-only queries) ─────────────────────

func TestGetCredits_Empty(t *testing.T) {
	balance := GetCredits("nonexistent", "g1nobody000000000000000000000000000000000")
	if balance != 0 {
		t.Fatalf("expected 0 credits, got %d", balance)
	}
}

func TestGetUsage_Empty(t *testing.T) {
	count := GetUsage("nonexistent", "g1nobody000000000000000000000000000000000")
	if count != 0 {
		t.Fatalf("expected 0 usage, got %d", count)
	}
}

// ── Validation Helpers ──────────────────────────────────────

func TestIsValidTransport(t *testing.T) {
	if !isValidTransport("stdio") {
		t.Fatal("stdio should be valid")
	}
	if !isValidTransport("sse") {
		t.Fatal("sse should be valid")
	}
	if !isValidTransport("streamable-http") {
		t.Fatal("streamable-http should be valid")
	}
	if isValidTransport("websocket") {
		t.Fatal("websocket should be invalid")
	}
	if isValidTransport("") {
		t.Fatal("empty should be invalid")
	}
}

func TestIsValidPricing(t *testing.T) {
	if !isValidPricing("free") {
		t.Fatal("free should be valid")
	}
	if !isValidPricing("pay-per-use") {
		t.Fatal("pay-per-use should be valid")
	}
	if !isValidPricing("subscription") {
		t.Fatal("subscription should be valid")
	}
	if isValidPricing("premium") {
		t.Fatal("premium should be invalid")
	}
}

// ── TruncAddr ───────────────────────────────────────────────

func TestTruncAddr(t *testing.T) {
	long := "g1x7k4628w93a7wzdhqc06atzx0v50rnshweuxu0"
	short := "g1short"

	resultLong := truncAddr(address(long))
	if resultLong != "g1x7k4628w..." {
		t.Fatalf("truncAddr(%s) = %s, want g1x7k4628w...", long, resultLong)
	}

	resultShort := truncAddr(address(short))
	if resultShort != "g1short" {
		t.Fatalf("truncAddr(%s) = %s, want g1short", short, resultShort)
	}
}
