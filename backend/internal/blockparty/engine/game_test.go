package engine

import (
	"encoding/json"
	"os"
	"testing"
)

func TestReplay_MatchesGameVectors(t *testing.T) {
	raw, err := os.ReadFile("testdata/game_vectors.json")
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	var vectors []struct {
		Seed                 uint32 `json:"seed"`
		Modifier             string `json:"modifier"`
		Moves                []Move `json:"moves"`
		ExpectedBoard        []int  `json:"expectedBoard"`
		ExpectedScore        int64  `json:"expectedScore"`
		ExpectedRngCallCount int    `json:"expectedRngCallCount"`
		ExpectedOver         bool   `json:"expectedOver"`
	}
	if err := json.Unmarshal(raw, &vectors); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if len(vectors) == 0 {
		t.Fatal("no vectors")
	}
	for vi, v := range vectors {
		r := Replay(v.Seed, v.Modifier, v.Moves)
		if r.Score != v.ExpectedScore {
			t.Fatalf("vec %d: score got %d want %d", vi, r.Score, v.ExpectedScore)
		}
		if r.RngCallCount != v.ExpectedRngCallCount {
			t.Fatalf("vec %d: rngCallCount got %d want %d", vi, r.RngCallCount, v.ExpectedRngCallCount)
		}
		if r.Over != v.ExpectedOver {
			t.Fatalf("vec %d: over got %v want %v", vi, r.Over, v.ExpectedOver)
		}
		for i := 0; i < 16; i++ {
			if r.Board[i] != v.ExpectedBoard[i] {
				t.Fatalf("vec %d: board[%d] got %d want %d", vi, i, r.Board[i], v.ExpectedBoard[i])
			}
		}
	}
}
