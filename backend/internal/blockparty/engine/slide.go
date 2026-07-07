package engine

// SlideLineLeft collapses a length-4 line toward index 0. Merge-once invariant:
// the source index advances by 2 on a merge, so a merged tile is never
// re-examined. Mirrors the TS slideLineLeft; keep integer-only for parity.
func SlideLineLeft(line []int) ([4]int, int) {
	nonZero := make([]int, 0, 4)
	for _, v := range line {
		if v != 0 {
			nonZero = append(nonZero, v)
		}
	}
	var result [4]int
	ri, gained, i := 0, 0, 0
	for i < len(nonZero) {
		if i+1 < len(nonZero) && nonZero[i] == nonZero[i+1] {
			merged := nonZero[i] * 2
			result[ri] = merged
			gained += merged
			ri++
			i += 2
		} else {
			result[ri] = nonZero[i]
			ri++
			i++
		}
	}
	return result, gained
}
