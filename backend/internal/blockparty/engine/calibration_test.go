package engine

import (
	"os"
	"sort"
	"testing"
)

// TestCalibrationSweep is an opt-in, deterministic seed sweep for par review:
//
//	BLOCKPARTY_CALIBRATE=1 go test ./internal/blockparty/engine -run TestCalibrationSweep -v
//
// The beam can see the public seed/RNG state, just as a determined player can.
// Its result is therefore an empirical reachable lower bound, not an estimate
// of novice play and not a mathematical maximum. Keep it opt-in so ordinary
// unit suites remain fast.
func TestCalibrationSweep(t *testing.T) {
	if os.Getenv("BLOCKPARTY_CALIBRATE") != "1" {
		t.Skip("set BLOCKPARTY_CALIBRATE=1 to run the deterministic seed sweep")
	}

	const seeds = 2048
	for _, scenario := range []struct {
		modifier Modifier
		budget   int
	}{
		{modifier: "standard", budget: 30},
		{modifier: "doubles", budget: 30},
		{modifier: "rush", budget: 24},
	} {
		scores := make([]int64, seeds)
		var total int64
		for seed := range seeds {
			scores[seed] = seedAwareBeamScore(uint32(seed), scenario.modifier, scenario.budget, 96)
			total += scores[seed]
		}
		sort.Slice(scores, func(i, j int) bool { return scores[i] < scores[j] })
		t.Logf(
			"modifier=%s budget=%d seeds=%d min=%d p10=%d p25=%d median=%d p75=%d p90=%d max=%d mean=%.1f",
			scenario.modifier,
			scenario.budget,
			seeds,
			scores[0],
			scores[seeds/10],
			scores[seeds/4],
			scores[seeds/2],
			scores[seeds*3/4],
			scores[seeds*9/10],
			scores[seeds-1],
			float64(total)/seeds,
		)
	}
}

type beamCandidate struct {
	state State
	value int64
}

func seedAwareBeamScore(seed uint32, modifier Modifier, budget, width int) int64 {
	beam := []beamCandidate{{state: InitGame(seed, modifier)}}
	for range budget {
		byBoard := make(map[[16]int]beamCandidate, len(beam)*2)
		for _, candidate := range beam {
			for _, move := range []Move{"L", "D", "R", "U"} {
				next := Step(candidate.state, move)
				if next.RngCallCount == candidate.state.RngCallCount {
					continue
				}
				key := boardKey(next.Board)
				replacement := beamCandidate{state: next, value: boardValue(next)}
				if prior, ok := byBoard[key]; !ok || betterCandidate(replacement, prior) {
					byBoard[key] = replacement
				}
			}
		}

		beam = beam[:0]
		for _, candidate := range byBoard {
			beam = append(beam, candidate)
		}
		sort.Slice(beam, func(i, j int) bool { return betterCandidate(beam[i], beam[j]) })
		if len(beam) > width {
			beam = beam[:width]
		}
		if len(beam) == 0 {
			break
		}
	}

	var best int64
	for _, candidate := range beam {
		if candidate.state.Score > best {
			best = candidate.state.Score
		}
	}
	return best
}

func boardKey(board Board) [16]int {
	var key [16]int
	copy(key[:], board)
	return key
}

func betterCandidate(a, b beamCandidate) bool {
	if a.value != b.value {
		return a.value > b.value
	}
	if a.state.Score != b.state.Score {
		return a.state.Score > b.state.Score
	}
	ka, kb := boardKey(a.state.Board), boardKey(b.state.Board)
	for i := range ka {
		if ka[i] != kb[i] {
			return ka[i] > kb[i]
		}
	}
	return false
}

func boardValue(state State) int64 {
	// Score is the objective. Empty cells preserve future merge options, while
	// a large corner tile and locally similar neighbours are useful, modest
	// tie-breakers. All arithmetic is integer and deterministic.
	value := state.Score * 10_000
	for i, tile := range state.Board {
		if tile == 0 {
			value += 1_000
			continue
		}
		if i == 0 || i == 3 || i == 12 || i == 15 {
			value += int64(tile) * 8
		}
		if i%4 != 3 && state.Board[i+1] == tile {
			value += int64(tile) * 2
		}
		if i < 12 && state.Board[i+4] == tile {
			value += int64(tile) * 2
		}
	}
	return value
}
