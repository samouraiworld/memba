package engine

import "testing"

func TestSlideLineLeft(t *testing.T) {
	cases := []struct {
		in     []int
		out    [4]int
		gained int
	}{
		{[]int{0, 2, 0, 4}, [4]int{2, 4, 0, 0}, 0},
		{[]int{2, 2, 0, 0}, [4]int{4, 0, 0, 0}, 4},
		{[]int{2, 2, 2, 2}, [4]int{4, 4, 0, 0}, 8},
		{[]int{4, 4, 2, 0}, [4]int{8, 2, 0, 0}, 8},
		{[]int{2, 4, 8, 16}, [4]int{2, 4, 8, 16}, 0},
		{[]int{2, 2, 2, 0}, [4]int{4, 2, 0, 0}, 4},
		{[]int{0, 0, 0, 0}, [4]int{0, 0, 0, 0}, 0},
	}
	for _, c := range cases {
		out, g := SlideLineLeft(c.in)
		if out != c.out || g != c.gained {
			t.Fatalf("in=%v got %v gained %d, want %v gained %d", c.in, out, g, c.out, c.gained)
		}
	}
}
