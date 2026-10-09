package blockparty

import (
	"context"
	"encoding/json"
	"os"
	"strings"
	"testing"
)

func TestFreePlayTSVectorsAndTerminalUndo(t *testing.T) {
	raw, err := os.ReadFile("../arcade/testdata/freeplay/vectors.json")
	if err != nil {
		t.Fatal(err)
	}
	var vectors struct {
		Runs []struct {
			Input     struct{ Seed, Replay string }
			Score     int64
			StateHash string
		}
	}
	if err = json.Unmarshal(raw, &vectors); err != nil {
		t.Fatal(err)
	}
	for _, v := range vectors.Runs {
		got, err := VerifyFreePlay(context.Background(), v.Input.Seed, v.Input.Replay)
		if err != nil {
			t.Fatal(err)
		}
		if got.Score != v.Score || got.StateHash != v.StateHash {
			t.Fatalf("TS parity %+v", got)
		}
		// Undo at game over is legal, but that intermediate board is not publishable.
		if _, err := VerifyFreePlay(context.Background(), v.Input.Seed, v.Input.Replay+"Z"); err == nil || err.Error() != "not_terminal" {
			t.Fatalf("terminal undo=%v", err)
		}
		// Undo then repeat the final accepted move returns precisely the same state.
		again, err := VerifyFreePlay(context.Background(), v.Input.Seed, v.Input.Replay+"Z"+v.Input.Replay[len(v.Input.Replay)-1:])
		if err != nil {
			t.Fatal(err)
		}
		if again.StateHash != got.StateHash || again.Score != got.Score {
			t.Fatal("undo did not restore RNG and score")
		}
	}
}
func TestFreePlayCertificationResourceBound(t *testing.T) {
	if _, err := VerifyFreePlay(context.Background(), "bp1:00001092", strings.Repeat("L", FreePlayMaxActions+1)); err == nil || err.Error() != "invalid_replay_size" {
		t.Fatal(err)
	}
}
