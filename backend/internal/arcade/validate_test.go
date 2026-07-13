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

func TestValidateJob_AcceptsAWellFormedSubmission(t *testing.T) {
	if err := ValidateJob("barricade-2026-07-13", CurrentSimVersion, json.RawMessage(`[]`)); err != nil {
		t.Fatalf("expected valid, got %v", err)
	}
	// Both seed shapes the shell produces are accepted.
	if err := ValidateJob("practice-1720000000000-3", CurrentSimVersion, rawEvents(t, 5)); err != nil {
		t.Fatalf("expected practice seed valid, got %v", err)
	}
}

func TestValidateJob_RejectsUnsupportedSimVersion(t *testing.T) {
	if err := ValidateJob("barricade-2026-07-13", 1, json.RawMessage(`[]`)); err == nil {
		t.Fatal("expected an unsupported-simVersion rejection")
	}
	if err := ValidateJob("barricade-2026-07-13", 99, json.RawMessage(`[]`)); err == nil {
		t.Fatal("expected an unsupported-simVersion rejection")
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
		if err := ValidateJob(seed, CurrentSimVersion, json.RawMessage(`[]`)); err == nil {
			t.Errorf("%s: expected rejection for seed %q", name, seed)
		}
	}
}

func TestValidateJob_RejectsNonArrayEvents(t *testing.T) {
	for _, ev := range []string{`5`, `{}`, `"nope"`, `null`, `not json`} {
		if err := ValidateJob("barricade-2026-07-13", CurrentSimVersion, json.RawMessage(ev)); err == nil {
			t.Errorf("expected rejection for events %q", ev)
		}
	}
}

func TestValidateJob_RejectsTooManyEvents(t *testing.T) {
	if err := ValidateJob("barricade-2026-07-13", CurrentSimVersion, rawEvents(t, MaxEvents+1)); err == nil {
		t.Fatalf("expected rejection for %d events (cap %d)", MaxEvents+1, MaxEvents)
	}
	if err := ValidateJob("barricade-2026-07-13", CurrentSimVersion, rawEvents(t, MaxEvents)); err != nil {
		t.Fatalf("exactly the cap must be allowed, got %v", err)
	}
}

func TestValidateJob_RejectsOversizePayload(t *testing.T) {
	// A payload over the byte cap must be rejected before it can reach node,
	// even if its element count is under MaxEvents.
	huge := json.RawMessage(`[` + `"` + strings.Repeat("x", MaxJobBytes) + `"` + `]`)
	if err := ValidateJob("barricade-2026-07-13", CurrentSimVersion, huge); err == nil {
		t.Fatal("expected rejection for an oversize events payload")
	}
}
