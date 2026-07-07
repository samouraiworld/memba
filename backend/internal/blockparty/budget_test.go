package blockparty

import "testing"

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
