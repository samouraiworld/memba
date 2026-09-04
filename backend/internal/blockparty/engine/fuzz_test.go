package engine

import (
	"reflect"
	"testing"
)

// FuzzReplayDeterministic exercises arbitrary bounded direction streams across
// every modifier. Besides catching panics, it pins the replay properties the
// score service relies on: deterministic output, bounded RNG consumption, and
// valid power-of-two board values.
func FuzzReplayDeterministic(f *testing.F) {
	f.Add(uint32(0), byte(0), []byte{0, 1, 2, 3})
	f.Add(^uint32(0), byte(1), []byte{3, 3, 0, 2, 1})
	f.Add(uint32(99236), byte(2), []byte{})

	modifiers := []Modifier{"standard", "doubles", "rush"}
	moves := []Move{"U", "R", "D", "L"}

	f.Fuzz(func(t *testing.T, seed uint32, modifierByte byte, raw []byte) {
		if len(raw) > 128 {
			t.Skip()
		}
		modifier := modifiers[int(modifierByte)%len(modifiers)]
		log := make([]Move, len(raw))
		for i, value := range raw {
			log[i] = moves[int(value)%len(moves)]
		}

		first := Replay(seed, modifier, log)
		second := Replay(seed, modifier, log)
		if !reflect.DeepEqual(first, second) {
			t.Fatalf("replay is not deterministic: first=%+v second=%+v", first, second)
		}
		if len(first.Board) != 16 {
			t.Fatalf("board has %d cells, want 16", len(first.Board))
		}
		if first.Score < 0 {
			t.Fatalf("score is negative: %d", first.Score)
		}
		if first.RngCallCount < 4 || first.RngCallCount > 4+2*len(log) || first.RngCallCount%2 != 0 {
			t.Fatalf("invalid RNG call count %d for %d inputs", first.RngCallCount, len(log))
		}
		minimumTile := 2
		if modifier == "doubles" {
			minimumTile = 4
		}
		for i, tile := range first.Board {
			if tile == 0 {
				continue
			}
			if tile < minimumTile || tile&(tile-1) != 0 {
				t.Fatalf("cell %d contains invalid %s tile %d", i, modifier, tile)
			}
		}
	})
}
