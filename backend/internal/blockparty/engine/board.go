package engine

type Board = []int
type Modifier = string
type Move = string

func EmptyCells(b Board) []int {
	out := make([]int, 0, 16)
	for i := 0; i < 16; i++ {
		if b[i] == 0 {
			out = append(out, i)
		}
	}
	return out
}

// SpawnTile mirrors the TS spawnTile exactly, including the full-board guard:
// with no empty cell it spawns nothing and consumes no RNG (JS returns NaN on
// % 0; Go would panic — the guard makes both languages agree).
func SpawnTile(b Board, rng uint32, rngCallCount int, mod Modifier) (Board, uint32, int) {
	empties := EmptyCells(b)
	next := append(Board(nil), b...) // copy
	if len(empties) == 0 {
		return next, rng, rngCallCount
	}
	// position draw
	val, st := RngNext(rng)
	pos := empties[int(val%uint32(len(empties)))] // #nosec G115 -- len(empties) is 0..16, well within uint32
	rng = st
	// value draw
	val, st = RngNext(rng)
	v := 2
	if val%10 == 0 {
		v = 4
	}
	rng = st
	if mod == "doubles" {
		v *= 2
	}
	next[pos] = v
	return next, rng, rngCallCount + 2
}
