package engine

func IsGameOver(b Board) bool {
	for i := 0; i < 16; i++ {
		if b[i] == 0 {
			return false
		}
	}
	for r := 0; r < 4; r++ {
		for c := 0; c < 4; c++ {
			v := b[r*4+c]
			if c < 3 && b[r*4+c+1] == v {
				return false
			}
			if r < 3 && b[(r+1)*4+c] == v {
				return false
			}
		}
	}
	return true
}
