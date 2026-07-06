package engine

import (
	"encoding/json"
	"os"
	"testing"
)

func TestReplay_MatchesDiffCorpus(t *testing.T) {
	raw, err := os.ReadFile("testdata/diff_corpus.json")
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	var corpus []struct {
		Seed                 uint32 `json:"seed"`
		Modifier             string `json:"modifier"`
		Moves                []Move `json:"moves"`
		ExpectedBoard        []int  `json:"expectedBoard"`
		ExpectedScore        int64  `json:"expectedScore"`
		ExpectedRngCallCount int    `json:"expectedRngCallCount"`
		ExpectedOver         bool   `json:"expectedOver"`
	}
	if err := json.Unmarshal(raw, &corpus); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if len(corpus) < 100 {
		t.Fatalf("corpus too small: %d", len(corpus))
	}
	for vi, v := range corpus {
		r := Replay(v.Seed, v.Modifier, v.Moves)
		if r.Score != v.ExpectedScore || r.RngCallCount != v.ExpectedRngCallCount || r.Over != v.ExpectedOver {
			t.Fatalf("corpus %d (seed %d): score %d/%d rng %d/%d over %v/%v",
				vi, v.Seed, r.Score, v.ExpectedScore, r.RngCallCount, v.ExpectedRngCallCount, r.Over, v.ExpectedOver)
		}
		for i := 0; i < 16; i++ {
			if r.Board[i] != v.ExpectedBoard[i] {
				t.Fatalf("corpus %d (seed %d): board[%d] %d != %d", vi, v.Seed, i, r.Board[i], v.ExpectedBoard[i])
			}
		}
	}
}
