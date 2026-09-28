package service

import (
	"os"
	"regexp"
	"strconv"
	"strings"
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

	// Sanity: the frontend registry is the full 84-quest set.
	if len(frontend) < 84 {
		t.Fatalf("parsed only %d frontend quests, expected >= 84 — parser likely missed some", len(frontend))
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
	legacy := map[string]bool{"view-profile": true, "directory-tabs": true, "gnodaokit-extension": true}
	for id := range validQuests {
		if legacy[id] {
			continue
		}
		if _, ok := frontend[id]; !ok {
			t.Errorf("backend validQuests has %q absent from frontend ALL_QUESTS (and not in the legacy allowlist)", id)
		}
	}
}

// TestQuestVerificationParity guards the backend questVerification map (the
// authority for what CompleteQuest grants without proof) against the frontend
// `verification:` field. Drift here would let the server grant XP for a quest
// the frontend treats as proof-only, or vice-versa.
func TestQuestVerificationParity(t *testing.T) {
	const frontendPath = "../../../frontend/src/lib/gnobuilders.ts"
	data, err := os.ReadFile(frontendPath)
	if err != nil {
		t.Fatalf("read frontend quests (%s): %v", frontendPath, err)
	}

	re := regexp.MustCompile(`id:\s*"([a-z0-9-]+)"[^\n]*?verification:\s*"(\w+)"`)
	matches := re.FindAllStringSubmatch(string(data), -1)
	if len(matches) < 84 {
		t.Fatalf("parsed only %d (id, verification) pairs, expected >= 84", len(matches))
	}

	for _, m := range matches {
		id, vtype := m[1], m[2]
		got, ok := questVerification[id]
		if !ok {
			t.Errorf("quest %q missing from backend questVerification map", id)
			continue
		}
		if got != vtype {
			t.Errorf("verification mismatch for %q: frontend=%q backend=%q", id, vtype, got)
		}
	}
}

// TestSelfReportSetsConsistent guards the two hand-maintained sources of truth
// for "is this a self-report quest": selfReportQuests (gates SubmitQuestClaim,
// quest_rpc.go) and questVerification[id]=="self_report" (gates CompleteQuest,
// quest_verify.go). A desync would let a self-report quest bypass admin review
// via CompleteQuest, or block a legitimate claim.
func TestSelfReportSetsConsistent(t *testing.T) {
	for id := range selfReportQuests {
		if questVerification[id] != "self_report" {
			t.Errorf("%q is in selfReportQuests but questVerification=%q (want self_report)", id, questVerification[id])
		}
	}
	for id, vtype := range questVerification {
		if vtype == "self_report" && !selfReportQuests[id] {
			t.Errorf("%q is questVerification=self_report but missing from selfReportQuests", id)
		}
	}
}

// New claims must match the curated frontend launch set. The hidden Konami
// trigger and two legacy auto-tracked IDs remain claimable outside that set.
func TestClaimableQuestCatalogParity(t *testing.T) {
	data, err := os.ReadFile("../../../frontend/src/lib/gnobuilders.ts")
	if err != nil {
		t.Fatal(err)
	}
	source := string(data)
	start := strings.Index(source, "export const LIVE_QUEST_IDS")
	if start < 0 {
		t.Fatal("LIVE_QUEST_IDS missing")
	}
	end := strings.Index(source[start:], "])")
	if end < 0 {
		t.Fatal("LIVE_QUEST_IDS closing delimiter missing")
	}
	block := source[start : start+end]
	live := map[string]bool{}
	for _, match := range regexp.MustCompile(`"([a-z0-9-]+)"`).FindAllStringSubmatch(block, -1) {
		live[match[1]] = true
	}
	claimable := map[string]bool{}
	for id := range offChainClaimableQuests {
		if id != "easter-egg-konami" && id != "view-profile" && id != "directory-tabs" {
			claimable[id] = true
		}
	}
	for id := range onChainClaimableQuests {
		claimable[id] = true
	}
	for id := range selfReportClaimableQuests {
		claimable[id] = true
	}
	for id := range liveDerivedQuestThresholds {
		if !metaQuests[id] {
			t.Errorf("derived quest %q is not classified as a meta quest", id)
		}
		claimable[id] = true
	}
	for id := range live {
		// The backend retires this unverified reward before the frontend rollout
		// in #1368. Remove this one-ID staging exception when that PR removes it
		// from LIVE_QUEST_IDS; all other live quests still need a grant path.
		if id == "submit-feedback" && retiredQuests[id] {
			continue
		}
		if !claimable[id] {
			t.Errorf("frontend live quest %q has no server grant path", id)
		}
	}
	for id := range claimable {
		if !live[id] {
			t.Errorf("server-claimable quest %q is not in frontend live catalog", id)
		}
	}
}
