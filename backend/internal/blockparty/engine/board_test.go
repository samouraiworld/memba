package engine

import "testing"

func full() Board { b := make(Board, 16); for i := range b { b[i] = 2 }; return b }

func TestEmptyCells_Ascending(t *testing.T) {
	b := Board{0, 2, 0, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0}
	got := EmptyCells(b)
	want := []int{0, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15}
	if len(got) != len(want) {
		t.Fatalf("len got %d want %d", len(got), len(want))
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("at %d got %d want %d", i, got[i], want[i])
		}
	}
}

func TestSpawnTile_PlacesOneTileTwoDraws(t *testing.T) {
	b := make(Board, 16)
	nb, _, cc := SpawnTile(b, 12345, 0, "standard")
	nonzero := 0
	var v int
	for _, x := range nb {
		if x != 0 { nonzero++; v = x }
	}
	if nonzero != 1 { t.Fatalf("nonzero=%d want 1", nonzero) }
	if v != 2 && v != 4 { t.Fatalf("value=%d want 2 or 4", v) }
	if cc != 2 { t.Fatalf("rngCallCount=%d want 2", cc) }
}

func TestSpawnTile_DoublesModifier(t *testing.T) {
	b := make(Board, 16)
	nb, _, _ := SpawnTile(b, 12345, 0, "doubles")
	var v int
	for _, x := range nb { if x != 0 { v = x } }
	if v != 4 && v != 8 { t.Fatalf("value=%d want 4 or 8", v) }
}

func TestSpawnTile_FullBoardNoOp(t *testing.T) {
	b := full()
	nb, rng, cc := SpawnTile(b, 12345, 7, "standard")
	for i := range b { if nb[i] != b[i] { t.Fatalf("board changed at %d", i) } }
	if rng != 12345 { t.Fatalf("rng changed: %d", rng) }
	if cc != 7 { t.Fatalf("rngCallCount changed: %d", cc) }
}
