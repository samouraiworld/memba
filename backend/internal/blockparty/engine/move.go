package engine

type State struct {
	Board        Board
	Score        int64
	Rng          uint32
	RngCallCount int
	Modifier     Modifier
	Moves        int
	Over         bool
}

// Each direction's 4 lines, each line's 4 indices in pull order (leading first).
var LineIndices = map[Move][4][4]int{
	"L": {{0, 1, 2, 3}, {4, 5, 6, 7}, {8, 9, 10, 11}, {12, 13, 14, 15}},
	"R": {{3, 2, 1, 0}, {7, 6, 5, 4}, {11, 10, 9, 8}, {15, 14, 13, 12}},
	"U": {{0, 4, 8, 12}, {1, 5, 9, 13}, {2, 6, 10, 14}, {3, 7, 11, 15}},
	"D": {{12, 8, 4, 0}, {13, 9, 5, 1}, {14, 10, 6, 2}, {15, 11, 7, 3}},
}

// ApplyMove returns the new state and whether the board changed. On a no-op it
// returns the input state unchanged with changed=false (no spawn, no RNG) —
// the Go-side equivalent of the TS identity-return no-op contract.
func ApplyMove(s State, m Move) (State, bool) {
	before := s.Board
	after := append(Board(nil), before...)
	var gained int
	for _, line := range LineIndices[m] {
		vals := []int{before[line[0]], before[line[1]], before[line[2]], before[line[3]]}
		slid, g := SlideLineLeft(vals)
		gained += g
		for k, idx := range line {
			after[idx] = slid[k]
		}
	}
	changed := false
	for i := 0; i < 16; i++ {
		if after[i] != before[i] {
			changed = true
			break
		}
	}
	if !changed {
		return s, false
	}
	nb, rng, cc := SpawnTile(after, s.Rng, s.RngCallCount, s.Modifier)
	ns := State{
		Board:        nb,
		Score:        s.Score + int64(gained),
		Rng:          rng,
		RngCallCount: cc,
		Modifier:     s.Modifier,
		Moves:        s.Moves + 1,
		Over:         false, // provisional — Step recomputes via IsGameOver
	}
	return ns, true
}
