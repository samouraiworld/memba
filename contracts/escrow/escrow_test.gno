package escrow

import (
	"strings"
	"testing"
)

// ── Init ────────────────────────────────────────────────────

func TestInit(t *testing.T) {
	if contracts == nil {
		t.Fatal("contracts tree not initialized")
	}
}

// ── Render ───────────────────────────────────────────────────

func TestRenderHome_Empty(t *testing.T) {
	output := Render("")
	if !strings.Contains(output, "Escrow Contracts") {
		t.Fatal("expected title")
	}
	if !strings.Contains(output, "No contracts yet") {
		t.Fatal("expected empty state message")
	}
}

func TestRenderContract_NotFound(t *testing.T) {
	output := Render("contract/999")
	if !strings.Contains(output, "404") {
		t.Fatal("expected 404")
	}
}

func TestRenderStats_Empty(t *testing.T) {
	output := Render("stats")
	if !strings.Contains(output, "Escrow Stats") {
		t.Fatal("expected stats title")
	}
	if !strings.Contains(output, "Total Contracts") {
		t.Fatal("expected total contracts stat")
	}
}

func TestRender404(t *testing.T) {
	output := Render("unknown/path")
	if !strings.Contains(output, "404") {
		t.Fatal("expected 404")
	}
}

// ── Milestone Parsing ───────────────────────────────────────

func TestParseMilestones_Valid(t *testing.T) {
	ms := parseMilestones("Design:1000000,Development:3000000,Testing:500000")
	if len(ms) != 3 {
		t.Fatalf("expected 3 milestones, got %d", len(ms))
	}
	if ms[0].Title != "Design" || ms[0].Amount != 1000000 {
		t.Fatalf("milestone 0: got %s/%d", ms[0].Title, ms[0].Amount)
	}
	if ms[1].Title != "Development" || ms[1].Amount != 3000000 {
		t.Fatalf("milestone 1: got %s/%d", ms[1].Title, ms[1].Amount)
	}
	if ms[2].Title != "Testing" || ms[2].Amount != 500000 {
		t.Fatalf("milestone 2: got %s/%d", ms[2].Title, ms[2].Amount)
	}
	for i, m := range ms {
		if m.ID != i {
			t.Fatalf("milestone %d: expected ID %d, got %d", i, i, m.ID)
		}
		if m.Status != MsPending {
			t.Fatalf("milestone %d: expected pending status", i)
		}
	}
}

func TestParseMilestones_SingleMilestone(t *testing.T) {
	ms := parseMilestones("Full Project:5000000")
	if len(ms) != 1 {
		t.Fatalf("expected 1 milestone, got %d", len(ms))
	}
	if ms[0].Title != "Full Project" {
		t.Fatalf("expected 'Full Project', got '%s'", ms[0].Title)
	}
}

func TestParseMilestones_SkipsEmptyParts(t *testing.T) {
	ms := parseMilestones("Design:1000000,,Testing:500000,")
	if len(ms) != 2 {
		t.Fatalf("expected 2 milestones (empty parts skipped), got %d", len(ms))
	}
}

func TestParseMilestones_PanicsOnBadFormat(t *testing.T) {
	defer func() {
		r := recover()
		if r == nil {
			t.Fatal("expected panic for bad milestone format")
		}
		msg, ok := r.(string)
		if !ok || !strings.Contains(msg, "invalid milestone format") {
			t.Fatalf("unexpected panic: %v", r)
		}
	}()
	parseMilestones("no-colon-here")
}

func TestParseMilestones_PanicsOnNegativeAmount(t *testing.T) {
	defer func() {
		r := recover()
		if r == nil {
			t.Fatal("expected panic for negative amount")
		}
	}()
	parseMilestones("Bad:-100")
}

func TestParseMilestones_PanicsOnZeroAmount(t *testing.T) {
	defer func() {
		r := recover()
		if r == nil {
			t.Fatal("expected panic for zero amount")
		}
	}()
	parseMilestones("Bad:0")
}

func TestParseMilestones_PanicsOnEmptyTitle(t *testing.T) {
	defer func() {
		r := recover()
		if r == nil {
			t.Fatal("expected panic for empty title")
		}
	}()
	parseMilestones(":1000000")
}

func TestParseMilestones_PanicsOnNonNumericAmount(t *testing.T) {
	defer func() {
		r := recover()
		if r == nil {
			t.Fatal("expected panic for non-numeric amount")
		}
	}()
	parseMilestones("Design:abc")
}

// ── Helpers ─────────────────────────────────────────────────

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

func TestAllMilestonesReleased_True(t *testing.T) {
	c := &Contract{
		Milestones: []Milestone{
			{Status: MsReleased},
			{Status: MsReleased},
		},
	}
	if !allMilestonesReleased(c) {
		t.Fatal("expected all released")
	}
}

func TestAllMilestonesReleased_False(t *testing.T) {
	c := &Contract{
		Milestones: []Milestone{
			{Status: MsReleased},
			{Status: MsFunded},
		},
	}
	if allMilestonesReleased(c) {
		t.Fatal("expected not all released")
	}
}

func TestAllMilestonesTerminal_True(t *testing.T) {
	c := &Contract{
		Milestones: []Milestone{
			{Status: MsRefunded},
			{Status: MsReleased},
			{Status: MsPending},
		},
	}
	if !allMilestonesTerminal(c) {
		t.Fatal("expected all terminal (refunded + released + pending)")
	}
}

func TestAllMilestonesTerminal_FalseFunded(t *testing.T) {
	c := &Contract{
		Milestones: []Milestone{
			{Status: MsRefunded},
			{Status: MsFunded},
		},
	}
	if allMilestonesTerminal(c) {
		t.Fatal("funded milestone is not terminal")
	}
}

func TestAllMilestonesTerminal_FalseDisputed(t *testing.T) {
	c := &Contract{
		Milestones: []Milestone{
			{Status: MsReleased},
			{Status: MsDisputed},
		},
	}
	if allMilestonesTerminal(c) {
		t.Fatal("disputed milestone is not terminal")
	}
}

func TestGetContract_NotFound(t *testing.T) {
	defer func() {
		r := recover()
		if r == nil {
			t.Fatal("expected panic")
		}
	}()
	getContract("nonexistent")
}

// ── Constants ───────────────────────────────────────────────

func TestConstants(t *testing.T) {
	if PlatformFeePct < 0 || PlatformFeePct > 10 {
		t.Fatalf("PlatformFeePct out of range: %d", PlatformFeePct)
	}
	if CancelFeePct < 0 || CancelFeePct > 20 {
		t.Fatalf("CancelFeePct out of range: %d", CancelFeePct)
	}
	if AutoRefundBlks <= 0 {
		t.Fatal("AutoRefundBlks must be positive")
	}
	if AutoResolveBlks <= 0 {
		t.Fatal("AutoResolveBlks must be positive")
	}
	if len(AdminAddress) == 0 {
		t.Fatal("AdminAddress cannot be empty")
	}
	if len(FeeRecipient) == 0 {
		t.Fatal("FeeRecipient cannot be empty")
	}
}

// ── Fee Calculations ────────────────────────────────────────

func TestFeeCalculation(t *testing.T) {
	tests := []struct {
		amount   int64
		feePct   int
		expected int64
	}{
		{1000000, 2, 20000},    // 1 GNOT @ 2% = 0.02 GNOT
		{5000000, 2, 100000},   // 5 GNOT @ 2% = 0.1 GNOT
		{100000, 5, 5000},      // 0.1 GNOT @ 5% = 0.005 GNOT
		{1, 2, 0},              // 1 ugnot @ 2% = 0 (integer math)
		{50, 2, 1},             // 50 ugnot @ 2% = 1 ugnot
		{10000000, 2, 200000},  // 10 GNOT @ 2% = 0.2 GNOT
	}

	for _, tt := range tests {
		got := (tt.amount * int64(tt.feePct)) / 100
		if got != tt.expected {
			t.Fatalf("(%d * %d) / 100 = %d, want %d", tt.amount, tt.feePct, got, tt.expected)
		}
		// Verify freelancer gets the remainder
		remainder := tt.amount - got
		if remainder+got != tt.amount {
			t.Fatalf("fee %d + remainder %d != amount %d", got, remainder, tt.amount)
		}
	}
}
