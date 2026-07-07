package engine

import (
	"encoding/json"
	"os"
	"testing"
)

func TestRngNext_MatchesGoldenVectors(t *testing.T) {
	raw, err := os.ReadFile("testdata/prng_vectors.json")
	if err != nil {
		t.Fatalf("read vectors: %v", err)
	}
	var v struct {
		Seed    uint32   `json:"seed"`
		Outputs []uint32 `json:"outputs"`
	}
	if err := json.Unmarshal(raw, &v); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	state := v.Seed
	for i, want := range v.Outputs {
		got, next := RngNext(state)
		if got != want {
			t.Fatalf("output %d: got %d want %d", i, got, want)
		}
		state = next
	}
}
