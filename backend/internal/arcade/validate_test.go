package arcade

import (
	"encoding/json"
	"strings"
	"testing"
)

func rawEvents(t *testing.T, n int) json.RawMessage {
	t.Helper()
	evs := make([]map[string]any, n)
	for i := range evs {
		evs[i] = map[string]any{"tick": 0, "type": "rally"}
	}
	b, err := json.Marshal(evs)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	return b
}

// rawTuples builds n well-formed invaders deltas with strictly-increasing ticks.
func rawTuples(t *testing.T, n int) json.RawMessage {
	t.Helper()
	tuples := make([][4]int64, n)
	for i := range tuples {
		tuples[i] = [4]int64{int64(i), 10, 1, 0}
	}
	b, err := json.Marshal(tuples)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	return b
}

func barricadeJob(seed string, simVersion int64, events json.RawMessage) Job {
	return Job{Seed: seed, SimVersion: simVersion, Events: events}
}

func invadersJob(seed string, simVersion, finalTick int64, events json.RawMessage) Job {
	return Job{Game: gameInvaders, Seed: seed, SimVersion: simVersion, FinalTick: finalTick, Events: events}
}

func TestValidateJob_AcceptsAWellFormedSubmission(t *testing.T) {
	if err := ValidateJob(barricadeJob("barricade-2026-07-13", simVersionBarricade, json.RawMessage(`[]`))); err != nil {
		t.Fatalf("expected valid, got %v", err)
	}
	// Both barricade seed shapes the shell produces are accepted, with or
	// without the explicit (grandfathered-empty) game field.
	if err := ValidateJob(Job{Game: gameBarricade, Seed: "practice-1720000000000-3", SimVersion: simVersionBarricade, Events: rawEvents(t, 5)}); err != nil {
		t.Fatalf("expected practice seed valid, got %v", err)
	}
	// A well-formed invaders job (its own sim version + a bounded finalTick).
	if err := ValidateJob(invadersJob("invaders-2026-07-13", simVersionInvaders, 600, rawTuples(t, 5))); err != nil {
		t.Fatalf("expected invaders job valid, got %v", err)
	}
}

func TestValidateJob_RejectsUnsupportedSimVersion(t *testing.T) {
	if err := ValidateJob(barricadeJob("barricade-2026-07-13", 1, json.RawMessage(`[]`))); err == nil {
		t.Fatal("expected an unsupported-simVersion rejection")
	}
	if err := ValidateJob(barricadeJob("barricade-2026-07-13", 99, json.RawMessage(`[]`))); err == nil {
		t.Fatal("expected an unsupported-simVersion rejection")
	}
}

func TestValidateJob_PerGameSimVersionAndCaps(t *testing.T) {
	// The sim version is PER GAME: barricade v2, invaders v1 — each game's
	// build rejects the other's number (a barricade log must never be verified
	// by the invaders sim, or vice versa, just because the integers collide).
	if err := ValidateJob(invadersJob("invaders-2026-07-13", simVersionBarricade, 600, json.RawMessage(`[]`))); err == nil {
		t.Fatal("invaders must reject barricade's sim version")
	}
	if err := ValidateJob(barricadeJob("barricade-2026-07-13", simVersionInvaders, json.RawMessage(`[]`))); err == nil {
		t.Fatal("barricade must reject invaders' sim version")
	}
	// An unknown game can never validate.
	if err := ValidateJob(Job{Game: "pong", Seed: "barricade-2026-07-13", SimVersion: 1, Events: json.RawMessage(`[]`)}); err == nil {
		t.Fatal("unknown game must be rejected")
	}

	// finalTick bounds: required-positive and capped for invaders…
	if err := ValidateJob(invadersJob("invaders-2026-07-13", simVersionInvaders, 0, json.RawMessage(`[]`))); err == nil {
		t.Fatal("invaders finalTick=0 must be rejected")
	}
	if err := ValidateJob(invadersJob("invaders-2026-07-13", simVersionInvaders, -1, json.RawMessage(`[]`))); err == nil {
		t.Fatal("invaders negative finalTick must be rejected")
	}
	if err := ValidateJob(invadersJob("invaders-2026-07-13", simVersionInvaders, MaxFinalTick+1, json.RawMessage(`[]`))); err == nil {
		t.Fatalf("invaders finalTick above %d must be rejected", MaxFinalTick)
	}
	if err := ValidateJob(invadersJob("invaders-2026-07-13", simVersionInvaders, MaxFinalTick, json.RawMessage(`[]`))); err != nil {
		t.Fatalf("exactly MaxFinalTick must be allowed, got %v", err)
	}
	// …and forbidden for barricade (a stray field must not smuggle meaning).
	if err := ValidateJob(Job{Seed: "barricade-2026-07-13", SimVersion: simVersionBarricade, FinalTick: 600, Events: json.RawMessage(`[]`)}); err == nil {
		t.Fatal("barricade finalTick must be rejected")
	}

	// Per-game event caps: invaders takes up to MaxEventsInvaders deltas
	// (> barricade's cap), and not one more.
	if err := ValidateJob(invadersJob("invaders-2026-07-13", simVersionInvaders, MaxFinalTick, rawTuples(t, MaxEventsInvaders))); err != nil {
		t.Fatalf("exactly MaxEventsInvaders must be allowed, got %v", err)
	}
	if err := ValidateJob(invadersJob("invaders-2026-07-13", simVersionInvaders, MaxFinalTick, rawTuples(t, MaxEventsInvaders+1))); err == nil {
		t.Fatal("invaders must reject more than MaxEventsInvaders deltas")
	}
}

func TestValidateJob_RejectsBadSeeds(t *testing.T) {
	cases := map[string]string{
		"empty":    "",
		"too long": strings.Repeat("a", MaxSeedLen+1),
		"newline":  "barricade-2026\n07-13",
		"quote":    `barricade-"drop"`,
		"control":  "seed\x00null",
		"space":    "barricade 2026",
	}
	for name, seed := range cases {
		if err := ValidateJob(barricadeJob(seed, simVersionBarricade, json.RawMessage(`[]`))); err == nil {
			t.Errorf("%s: expected rejection for seed %q", name, seed)
		}
	}
}

func TestValidateJob_RejectsNonArrayEvents(t *testing.T) {
	for _, ev := range []string{`5`, `{}`, `"nope"`, `null`, `not json`} {
		if err := ValidateJob(barricadeJob("barricade-2026-07-13", simVersionBarricade, json.RawMessage(ev))); err == nil {
			t.Errorf("expected rejection for events %q", ev)
		}
	}
}

func TestValidateJob_RejectsTooManyEvents(t *testing.T) {
	if err := ValidateJob(barricadeJob("barricade-2026-07-13", simVersionBarricade, rawEvents(t, MaxEvents+1))); err == nil {
		t.Fatalf("expected rejection for %d events (cap %d)", MaxEvents+1, MaxEvents)
	}
	if err := ValidateJob(barricadeJob("barricade-2026-07-13", simVersionBarricade, rawEvents(t, MaxEvents))); err != nil {
		t.Fatalf("exactly the cap must be allowed, got %v", err)
	}
}

func TestValidateJob_RejectsOversizePayload(t *testing.T) {
	// A payload over the byte cap must be rejected before it can reach node,
	// even if its element count is under MaxEvents.
	huge := json.RawMessage(`[` + `"` + strings.Repeat("x", MaxJobBytes) + `"` + `]`)
	if err := ValidateJob(barricadeJob("barricade-2026-07-13", simVersionBarricade, huge)); err == nil {
		t.Fatal("expected rejection for an oversize events payload")
	}
}

// TestInvadersEngineSeed_Vectors pins the SHARED string→uint32 seed derivation
// (FNV-1a/32 over the seed string's UTF-8 bytes). Three implementations must
// agree byte-for-byte: this Go spec, the verify worker's TS twin
// (worker/verify_worker.ts fnv1aSeed — proven equivalent end-to-end by the
// Space Invaders loop fixture, whose expected stateHash only reproduces if the
// worker derived these exact engine seeds), and the frontend M3 client, which
// MUST implement the same function against these vectors before it can submit.
func TestInvadersEngineSeed_Vectors(t *testing.T) {
	vectors := map[string]uint32{
		"":                                  2166136261, // FNV-1a offset basis
		"a":                                 3826002220,
		"abc":                               440920331,
		"invaders-2026-07-13":               3389276757,
		"invaders-2026-09-01":               3070363140,
		"invaders-practice-1720000000000-3": 4290068228,
	}
	for seed, want := range vectors {
		if got := invadersEngineSeed(seed); got != want {
			t.Errorf("invadersEngineSeed(%q) = %d, want %d", seed, got, want)
		}
	}
}
