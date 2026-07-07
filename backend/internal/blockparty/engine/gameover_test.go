package engine

import "testing"

func TestIsGameOver(t *testing.T) {
	if IsGameOver(Board{2, 4, 8, 16, 4, 8, 16, 32, 8, 16, 32, 64, 16, 32, 64, 0}) {
		t.Fatal("empty cell => not over")
	}
	if IsGameOver(Board{2, 2, 8, 16, 4, 8, 16, 32, 8, 16, 32, 64, 16, 32, 64, 128}) {
		t.Fatal("horizontal merge => not over")
	}
	if IsGameOver(Board{2, 4, 8, 16, 2, 8, 16, 32, 8, 16, 32, 64, 16, 32, 64, 128}) {
		t.Fatal("vertical merge => not over")
	}
	if !IsGameOver(Board{2, 4, 8, 16, 4, 8, 16, 32, 8, 16, 32, 64, 16, 32, 64, 128}) {
		t.Fatal("full no-merge => over")
	}
}
