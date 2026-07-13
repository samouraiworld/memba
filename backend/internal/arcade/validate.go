// Package arcade re-verifies BARRICADE run submissions by re-simulating the
// player's input log in an isolated node subprocess (the same sim the client
// ran, esbuild-bundled and go:embed'd). Nothing here trusts a client-claimed
// score: the attester only ever writes the re-simulated result.
package arcade

import (
	"encoding/json"
	"fmt"
)

const (
	// CurrentSimVersion is the single sim version this worker build re-simulates.
	// A submission for any other version is rejected (a future season routes to a
	// frozen build); it must track the frontend sim's SIM_VERSION.
	CurrentSimVersion = 2

	// MaxEvents mirrors the sim's MAX_REPLAY_EVENTS: the shell stops recording at
	// this count, so an honest log can never exceed it. Bounds the verifier's cost.
	MaxEvents = 20_000

	// MaxSeedLen bounds the seed string. Daily seeds are "barricade-YYYY-MM-DD"
	// and practice seeds "practice-<ts>-<n>"; 128 is comfortably above both.
	MaxSeedLen = 128

	// MaxJobBytes caps the serialized events payload BEFORE it reaches node, so a
	// crafted submission can't smuggle unbounded bytes past the element-count cap
	// (e.g. one giant string). 4 MiB is far above any honest few-hundred-event log.
	MaxJobBytes = 4 << 20
)

// ValidateJob rejects a submission on shape/size grounds BEFORE any node process
// is spawned — the cheap, deterministic gate in front of the expensive re-sim.
// A caller that skips it is still safe (the worker re-validates and runReplay
// sanitizes), but then it pays to launch node for garbage.
func ValidateJob(seed string, simVersion int64, events json.RawMessage) error {
	if simVersion != CurrentSimVersion {
		return fmt.Errorf("unsupported simVersion %d: worker build is v%d", simVersion, CurrentSimVersion)
	}
	if err := validateSeed(seed); err != nil {
		return err
	}
	if len(events) > MaxJobBytes {
		return fmt.Errorf("events payload too large: %d bytes > %d", len(events), MaxJobBytes)
	}
	// Require an actual array: `json.Unmarshal("null", &[]…)` succeeds as a nil
	// slice in Go, so a bare `null` (or missing field) would otherwise slip past
	// the element-count cap. Demand a leading '[' first.
	if !startsWithArray(events) {
		return fmt.Errorf("events must be a JSON array")
	}
	// Parse only the array structure — elements stay raw (the worker parses each).
	// This both proves it's well-formed and yields the element count cheaply.
	var arr []json.RawMessage
	if err := json.Unmarshal(events, &arr); err != nil {
		return fmt.Errorf("events must be a JSON array: %w", err)
	}
	if len(arr) > MaxEvents {
		return fmt.Errorf("too many events: %d > %d", len(arr), MaxEvents)
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
