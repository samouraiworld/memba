package service

import (
	"os"
	"regexp"
	"strconv"
	"testing"
)

// TestQuestRegistryParity guards against drift between the frontend quest
// registry (frontend/src/lib/gnobuilders.ts ALL_QUESTS) and the backend
// validQuests map. The two MUST agree: every frontend quest exists in
// validQuests with identical XP, and every backend quest exists in the
// frontend except a known legacy allowlist (ids kept for backward-compat
// after the v2 renames — see quest_rpc.go).
//
// Phase 0 adds a server-side `status` curation on the frontend and a
// server-side verification switch on the backend; the registries will be
// edited on both sides during this work, so this guard runs in CI to catch
// a server that grants XP for a quest the catalog hides (or vice-versa).
func TestQuestRegistryParity(t *testing.T) {
	const frontendPath = "../../../frontend/src/lib/gnobuilders.ts"
	data, err := os.ReadFile(frontendPath)
	if err != nil {
		t.Fatalf("read frontend quests (%s): %v", frontendPath, err)
	}

	// Each quest is a single-line object literal: { id: "x", ... xp: N, ... }.
	// id always precedes xp on the same line. RANK_TIERS use `xpRequired:`
	// (no `xp:` token) and carry no `id:`, so they don't match.
	re := regexp.MustCompile(`id:\s*"([a-z0-9-]+)"[^\n]*?\bxp:\s*(\d+)`)
	matches := re.FindAllStringSubmatch(string(data), -1)
	if len(matches) == 0 {
		t.Fatal("no quests parsed from frontend gnobuilders.ts — regex or path broken")
	}

	frontend := make(map[string]uint32, len(matches))
	for _, m := range matches {
		xp, _ := strconv.Atoi(m[2])
		frontend[m[1]] = uint32(xp) // #nosec G115 -- quest XP is small (<=100)
	}

	// Sanity: the frontend registry is the full 85-quest set.
	if len(frontend) < 85 {
		t.Fatalf("parsed only %d frontend quests, expected >= 85 — parser likely missed some", len(frontend))
	}

	// 1. Every frontend quest exists in validQuests with matching XP.
	for id, xp := range frontend {
		got, ok := validQuests[id]
		if !ok {
			t.Errorf("frontend quest %q missing from backend validQuests", id)
			continue
		}
		if got != xp {
			t.Errorf("XP mismatch for %q: frontend=%d backend=%d", id, xp, got)
		}
	}

	// 2. Every backend quest exists in the frontend, except known legacy ids.
	legacy := map[string]bool{"view-profile": true, "directory-tabs": true}
	for id := range validQuests {
		if legacy[id] {
			continue
		}
		if _, ok := frontend[id]; !ok {
			t.Errorf("backend validQuests has %q absent from frontend ALL_QUESTS (and not in the legacy allowlist)", id)
		}
	}
}
