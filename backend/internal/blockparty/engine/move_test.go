package engine

import "testing"

func st(b Board) State {
	return State{Board: b, Score: 0, Rng: 555, RngCallCount: 0, Modifier: "standard", Moves: 0, Over: false}
}

func TestApplyMove_LeftMerge(t *testing.T) {
	s := st(Board{2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0})
	ns, changed := ApplyMove(s, "L")
	if !changed {
		t.Fatal("expected changed")
	}
	if ns.Board[0] != 4 {
		t.Fatalf("board[0]=%d want 4", ns.Board[0])
	}
	if ns.Score != 4 {
		t.Fatalf("score=%d want 4", ns.Score)
	}
	if ns.RngCallCount != 2 {
		t.Fatalf("rngCallCount=%d want 2", ns.RngCallCount)
	}
}

func TestApplyMove_Right(t *testing.T) {
	s := st(Board{2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0})
	ns, _ := ApplyMove(s, "R")
	if ns.Board[3] != 4 {
		t.Fatalf("board[3]=%d want 4", ns.Board[3])
	}
}

func TestApplyMove_Up(t *testing.T) {
	s := st(Board{0, 0, 0, 0, 2, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0})
	ns, _ := ApplyMove(s, "U")
	if ns.Board[0] != 4 {
		t.Fatalf("board[0]=%d want 4", ns.Board[0])
	}
}

func TestApplyMove_NoOp(t *testing.T) {
	s := st(Board{2, 4, 8, 16, 4, 8, 16, 32, 8, 16, 32, 64, 16, 32, 64, 128})
	ns, changed := ApplyMove(s, "L")
	if changed {
		t.Fatal("expected no-op")
	}
	if ns.RngCallCount != 0 {
		t.Fatalf("rngCallCount=%d want 0", ns.RngCallCount)
	}
}
