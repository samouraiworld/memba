package blockparty

import "github.com/samouraiworld/memba/backend/internal/blockparty/engine"

// MoveBudget is the ranked-daily move cap for a modifier. Server-authoritative:
// SubmitScore rejects logs longer than this, and GetDailyChallenge returns it so
// the client stops the ranked run at the same point.
func MoveBudget(modifier string) int {
	if modifier == "rush" {
		return 24
	}
	return 30
}

// TheoreticalScoreCeiling returns an absolute upper bound for a ranked run.
//
// A run starts with two tiles and every accepted move spawns one more.
// Standard/Rush spawns are at most 4; Doubles spawns are at most 8. At merge
// level k, at most floor(tileCount / 2^k) groups can reach that level, and each
// contributes spawnMax * 2^k points at that merge. Board geometry and the 10%
// maximum-value spawn rate can only lower this bound.
//
// This is analysis/presentation tooling, not an authoritative gameplay rule;
// it does not alter budgets, replay semantics, scoring, or stored scores.
func TheoreticalScoreCeiling(modifier string) int64 {
	spawnMax := int64(4)
	if modifier == "doubles" {
		spawnMax = 8
	}
	tileCount := MoveBudget(modifier) + 2
	var ceiling int64
	for groupSize := 2; groupSize <= tileCount; groupSize *= 2 {
		ceiling += int64(tileCount/groupSize) * int64(groupSize) * spawnMax
	}
	return ceiling
}

// SeedScoreCeiling tightens TheoreticalScoreCeiling for a specific challenge
// by using its deterministic spawn-value sequence. It still ignores board
// geometry, so it remains an upper bound rather than a promise that the score
// can actually be reached.
//
// Spawn positions do not affect the value draws: every accepted move consumes
// exactly one position draw and one value draw. SubmitScore rejects no-ops, so
// a ranked log of MoveBudget(modifier) accepted moves always has this sequence.
func SeedScoreCeiling(seed uint32, modifier string) int64 {
	rng := seed
	counts := make(map[int]int)
	for range MoveBudget(modifier) + 2 {
		_, rng = engine.RngNext(rng) // position draw
		valueDraw, next := engine.RngNext(rng)
		rng = next
		value := 2
		if valueDraw%10 == 0 {
			value = 4
		}
		if modifier == "doubles" {
			value *= 2
		}
		counts[value]++
	}
	return mergeScoreCeiling(counts)
}

func mergeScoreCeiling(counts map[int]int) int64 {
	var score int64
	// Ranked budgets yield at most 32 leaves, so 64 is already above any
	// possible base tile. Continue while a value can still form a pair.
	for value := 2; value <= 256; value *= 2 {
		pairs := counts[value] / 2
		if pairs == 0 {
			continue
		}
		merged := value * 2
		score += int64(pairs * merged)
		counts[merged] += pairs
	}
	return score
}
