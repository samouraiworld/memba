package blockparty

import (
	"os"
	"sort"
	"testing"
)

func TestMoveBudget(t *testing.T) {
	if MoveBudget("rush") != 24 {
		t.Fatalf("rush budget = %d, want 24", MoveBudget("rush"))
	}
	for _, m := range []string{"standard", "doubles", "unknown"} {
		if MoveBudget(m) != 30 {
			t.Fatalf("%s budget = %d, want 30", m, MoveBudget(m))
		}
	}
}

func TestTheoreticalScoreCeiling(t *testing.T) {
	tests := []struct {
		modifier string
		want     int64
	}{
		{modifier: "standard", want: 640},
		{modifier: "doubles", want: 1280},
		{modifier: "rush", want: 360},
		// Unknown modifiers follow MoveBudget's Standard-compatible defaults.
		{modifier: "unknown", want: 640},
	}
	for _, tt := range tests {
		if got := TheoreticalScoreCeiling(tt.modifier); got != tt.want {
			t.Errorf("TheoreticalScoreCeiling(%q) = %d, want %d", tt.modifier, got, tt.want)
		}
	}
}

func TestCurrentParRangeExceedsStandardAndRushCeilings(t *testing.T) {
	const minimumCurrentPar int64 = 1000
	for _, modifier := range []string{"standard", "rush"} {
		if ceiling := TheoreticalScoreCeiling(modifier); ceiling >= minimumCurrentPar {
			t.Errorf("%s ceiling = %d, expected below current minimum par %d", modifier, ceiling, minimumCurrentPar)
		}
	}
}

func TestSeedScoreCeilingNeverExceedsAbsoluteCeiling(t *testing.T) {
	for _, modifier := range []string{"standard", "doubles", "rush"} {
		absolute := TheoreticalScoreCeiling(modifier)
		for seed := uint32(0); seed < 10_000; seed++ {
			if got := SeedScoreCeiling(seed, modifier); got > absolute {
				t.Fatalf("SeedScoreCeiling(%d, %q) = %d, absolute ceiling %d", seed, modifier, got, absolute)
			}
		}
	}
}

func TestSeedScoreCeilingGolden(t *testing.T) {
	tests := []struct {
		seed     uint32
		modifier string
		want     int64
	}{
		{seed: 0, modifier: "standard", want: 320},
		{seed: 1, modifier: "doubles", want: 624},
		{seed: 42, modifier: "rush", want: 180},
		{seed: 4_294_967_295, modifier: "standard", want: 316},
	}
	for _, tt := range tests {
		if got := SeedScoreCeiling(tt.seed, tt.modifier); got != tt.want {
			t.Errorf("SeedScoreCeiling(%d, %q) = %d, want %d", tt.seed, tt.modifier, got, tt.want)
		}
	}
}

// TestCurrentParReachabilitySweep quantifies the legacy par heuristic against
// the seed-specific ceiling without slowing the normal unit suite.
func TestCurrentParReachabilitySweep(t *testing.T) {
	if os.Getenv("BLOCKPARTY_CALIBRATE") != "1" {
		t.Skip("set BLOCKPARTY_CALIBRATE=1 to run the deterministic par sweep")
	}

	const seeds = 1_000_000
	type summary struct {
		ceilings  []int64
		reachable int
	}
	byModifier := map[string]*summary{
		"standard": {},
		"doubles":  {},
		"rush":     {},
	}
	for seed := range seeds {
		s := uint32(seed)
		modifier := DeriveModifier(s)
		ceiling := SeedScoreCeiling(s, modifier)
		result := byModifier[modifier]
		result.ceilings = append(result.ceilings, ceiling)
		if DerivePar(s) <= ceiling {
			result.reachable++
		}
	}

	for _, modifier := range []string{"standard", "doubles", "rush"} {
		result := byModifier[modifier]
		sort.Slice(result.ceilings, func(i, j int) bool { return result.ceilings[i] < result.ceilings[j] })
		n := len(result.ceilings)
		t.Logf(
			"modifier=%s seeds=%d seed-ceiling-min=%d median=%d max=%d legacy-par-within-ceiling=%d (%.4f%%)",
			modifier,
			n,
			result.ceilings[0],
			result.ceilings[n/2],
			result.ceilings[n-1],
			result.reachable,
			float64(result.reachable)*100/float64(n),
		)
	}
}
