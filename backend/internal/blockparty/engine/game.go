package engine

// InitGame seeds a fresh board with two spawned tiles, mirroring the TS
// initGame: rngCallCount lands at 4 (two SpawnTile calls, 2 RNG draws each).
func InitGame(seed uint32, mod Modifier) State {
	empty := make(Board, 16)
	b1, rng1, cc1 := SpawnTile(empty, seed, 0, mod)
	b2, rng2, cc2 := SpawnTile(b1, rng1, cc1, mod)
	return State{
		Board:        b2,
		Score:        0,
		Rng:          rng2,
		RngCallCount: cc2,
		Modifier:     mod,
		Moves:        0,
		Over:         IsGameOver(b2),
	}
}

// Step applies a move and, only if the board changed, recomputes Over. A
// no-op move returns the input state unchanged.
func Step(s State, m Move) State {
	ns, changed := ApplyMove(s, m)
	if !changed {
		return s
	}
	ns.Over = IsGameOver(ns.Board)
	return ns
}

// Result is the terminal outcome of a Replay run.
type Result struct {
	Board        Board
	Score        int64
	RngCallCount int
	Over         bool
}

// Replay reproduces a full game from a seed and a sequence of moves.
func Replay(seed uint32, mod Modifier, moves []Move) Result {
	s := InitGame(seed, mod)
	for _, m := range moves {
		s = Step(s, m)
	}
	return Result{Board: s.Board, Score: s.Score, RngCallCount: s.RngCallCount, Over: s.Over}
}
