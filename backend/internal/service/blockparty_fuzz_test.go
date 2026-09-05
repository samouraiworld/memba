package service

import "testing"

// FuzzParseBlockPartyMoves verifies that the submission parser accepts exactly
// bounded ASCII UDLR logs. This is the first untrusted boundary before replay.
func FuzzParseBlockPartyMoves(f *testing.F) {
	f.Add("UDLR")
	f.Add("U\x00L")
	f.Add("↑")
	f.Add("")

	f.Fuzz(func(t *testing.T, input string) {
		moves, ok := parseMoves(input)
		wantOK := len(input) <= maxMoveLog
		if wantOK {
			for i := 0; i < len(input); i++ {
				switch input[i] {
				case 'U', 'D', 'L', 'R':
				default:
					wantOK = false
				}
			}
		}
		if ok != wantOK {
			t.Fatalf("parseMoves(%q) ok=%v, want %v", input, ok, wantOK)
		}
		if ok && len(moves) != len(input) {
			t.Fatalf("accepted %d bytes as %d moves", len(input), len(moves))
		}
	})
}
