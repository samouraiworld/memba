// Package arcade re-verifies arcade run submissions (BARRICADE, Space
// Invaders) by re-simulating the player's input log in an isolated node
// subprocess (the same sims the clients ran, esbuild-bundled and go:embed'd).
// Nothing here trusts a client-claimed score: the attester only ever writes
// the re-simulated result.
package arcade

import (
	"encoding/json"
	"fmt"
)

// Game slugs. These are the ONLY values the backend ever derives (from the
// seed grammar in deriveGameModeDay) — a client-sent game string is never
// trusted, and the realm's slug charset [a-z0-9-] is satisfied by construction.
const (
	gameBarricade = "barricade"
	gameInvaders  = "invaders"
)

const (
	// simVersionBarricade is the single BARRICADE sim version this worker build
	// re-simulates; it must track frontend/src/games/barricade/sim SIM_VERSION.
	// simVersionInvaders tracks the Space Invaders engine + its replay wire
	// format (REPLAY_VERSION in frontend/src/games/space-invaders/lib/replay.ts).
	// A submission for any other version is rejected (a future season routes to
	// a frozen build).
	simVersionBarricade = 2
	simVersionInvaders  = 1

	// MaxEvents mirrors the BARRICADE sim's MAX_REPLAY_EVENTS: the shell stops
	// recording at this count, so an honest log can never exceed it. Bounds the
	// verifier's cost.
	MaxEvents = 20_000

	// MaxEventsInvaders bounds a Space Invaders input log (delta-encoded
	// [tick, move10, fire, pause] tuples — one per input CHANGE; 10k is a
	// sustained change every ~360ms for a full max-length run, far above
	// honest twitch play).
	MaxEventsInvaders = 10_000

	// MaxFinalTick bounds a Space Invaders run's length in 60Hz engine ticks
	// (216_000 = 1 hour — SI daily runs live in minutes; the engine itself
	// steps 600k ticks in ~0.2s, so ticks alone are cheap).
	//
	// ⚠ The REAL CPU ceiling is the PRODUCT MaxFinalTick × MaxEventsInvaders:
	// the frontend verifier's inputAtTick does a linear scan of the delta list
	// per tick (O(T×D) total), so an adversarial log (all deltas packed at
	// tick 0) costs ~T×D scan steps. Benchmarked through the real worker
	// (M-series laptop): 216k×10k packed = 1.9s; the originally-planned
	// 600k×60k packed = 31.5s — past the 20s runner timeout before prod's
	// slower vCPUs are even considered. Raising EITHER cap needs a re-bench,
	// or an O(T+D) input cursor in the frontend verifier first (an M3-side
	// refactor — the worker deliberately runs the frontend's simulateReplay
	// verbatim rather than porting the loop).
	MaxFinalTick = 216_000

	// MaxSeedLen bounds the seed string. Daily seeds are "<game>-YYYY-MM-DD"
	// and practice seeds "practice-<ts>-<n>" / "invaders-practice-<ts>-<n>";
	// 128 is comfortably above all of them.
	MaxSeedLen = 128

	// MaxJobBytes caps the serialized events payload BEFORE it reaches node, so a
	// crafted submission can't smuggle unbounded bytes past the element-count cap
	// (e.g. one giant string). 4 MiB is far above any honest log.
	MaxJobBytes = 4 << 20
)

// simVersionFor maps a game to the single sim version this worker build
// re-simulates for it, or 0 for an unknown game. An empty game is grandfathered
// as BARRICADE (the pre-multigame job shape).
func simVersionFor(game string) int64 {
	switch game {
	case "", gameBarricade:
		return simVersionBarricade
	case gameInvaders:
		return simVersionInvaders
	default:
		return 0
	}
}

// maxEventsFor returns a game's input-log element cap.
func maxEventsFor(game string) int {
	if game == gameInvaders {
		return MaxEventsInvaders
	}
	return MaxEvents
}

// ValidateJob rejects a submission on shape/size grounds BEFORE any node process
// is spawned — the cheap, deterministic gate in front of the expensive re-sim.
// A caller that skips it is still safe (the worker re-validates and the sims
// sanitize), but then it pays to launch node for garbage.
func ValidateJob(job Job) error {
	game := job.Game
	if game == "" {
		game = gameBarricade
	}
	want := simVersionFor(game)
	if want == 0 {
		return fmt.Errorf("unknown game %q", game)
	}
	if job.SimVersion != want {
		return fmt.Errorf("unsupported simVersion %d for %s: worker build is v%d", job.SimVersion, game, want)
	}
	if err := validateSeed(job.Seed); err != nil {
		return err
	}
	// finalTick is a Space Invaders concept (the sim runs to a tick count, not
	// to a terminal phase): required and bounded there, forbidden elsewhere so a
	// stray field can't smuggle meaning into a game that ignores it.
	if game == gameInvaders {
		if job.FinalTick <= 0 {
			return fmt.Errorf("finalTick must be positive for %s", game)
		}
		if job.FinalTick > MaxFinalTick {
			return fmt.Errorf("finalTick too large: %d > %d", job.FinalTick, MaxFinalTick)
		}
	} else if job.FinalTick != 0 {
		return fmt.Errorf("finalTick is not a %s field", game)
	}
	if len(job.Events) > MaxJobBytes {
		return fmt.Errorf("events payload too large: %d bytes > %d", len(job.Events), MaxJobBytes)
	}
	// Require an actual array: `json.Unmarshal("null", &[]…)` succeeds as a nil
	// slice in Go, so a bare `null` (or missing field) would otherwise slip past
	// the element-count cap. Demand a leading '[' first.
	if !startsWithArray(job.Events) {
		return fmt.Errorf("events must be a JSON array")
	}
	// Parse only the array structure — elements stay raw (the worker parses each).
	// This both proves it's well-formed and yields the element count cheaply.
	var arr []json.RawMessage
	if err := json.Unmarshal(job.Events, &arr); err != nil {
		return fmt.Errorf("events must be a JSON array: %w", err)
	}
	if max := maxEventsFor(game); len(arr) > max {
		return fmt.Errorf("too many events: %d > %d", len(arr), max)
	}
	return nil
}

// startsWithArray reports whether the first non-whitespace byte is '['.
func startsWithArray(raw json.RawMessage) bool {
	for i := range len(raw) {
		switch raw[i] {
		case ' ', '\t', '\n', '\r':
			continue
		case '[':
			return true
		default:
			return false
		}
	}
	return false
}

// validateSeed enforces a conservative charset so a seed can never carry a shell
// metacharacter, quote, whitespace, or control byte into the job JSON. The seed
// only ever names a daily date or a practice run.
func validateSeed(seed string) error {
	if seed == "" {
		return fmt.Errorf("seed must be non-empty")
	}
	if len(seed) > MaxSeedLen {
		return fmt.Errorf("seed too long: %d > %d", len(seed), MaxSeedLen)
	}
	for i := range len(seed) {
		c := seed[i]
		ok := (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
			(c >= '0' && c <= '9') || c == '-' || c == '_' || c == '.' || c == ':'
		if !ok {
			return fmt.Errorf("seed has an illegal character at index %d", i)
		}
	}
	return nil
}

// invadersEngineSeed is the SHARED seed derivation for Space Invaders: the
// engine's numeric uint32 seed is FNV-1a (32-bit) over the seed STRING's UTF-8
// bytes. The verify worker implements the same function in TS
// (worker/verify_worker.ts) and the frontend (M3) MUST match it byte-for-byte
// — TestInvadersEngineSeed_Vectors pins reference vectors for all three.
// The backend itself only needs it as the executable spec (the worker derives
// its own copy inside node).
func invadersEngineSeed(seed string) uint32 {
	h := uint32(2166136261) // FNV offset basis
	for i := 0; i < len(seed); i++ {
		h ^= uint32(seed[i])
		h *= 16777619 // FNV prime
	}
	return h
}
