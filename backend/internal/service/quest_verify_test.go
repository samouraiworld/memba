package service

import (
	"context"
	"testing"
	"time"

	"connectrpc.com/connect"
	membav1 "github.com/samouraiworld/memba/backend/gen/memba/v1"
)

// stubChainVerify installs a deterministic on-chain verifier so these tests
// never hit the network. Returns whatever `ok` says for any on_chain quest.
func (h *testHarness) stubChainVerify(ok bool) {
	h.svc.verifyOnChainQuest = func(_ context.Context, _, _, _ string) (bool, error) {
		return ok, nil
	}
}

// P0-1: self_report quests must NOT be grantable via CompleteQuest — they
// require admin-reviewed proof (SubmitQuestClaim). Otherwise any authenticated
// user could fabricate the 100-XP "fix-upstream-bug" via a direct RPC.
func TestCompleteQuest_RejectsSelfReport(t *testing.T) {
	h := setup(t)
	token := h.makeToken(t, "g1alice")
	ctx := context.Background()

	_, err := h.svc.CompleteQuest(ctx, connect.NewRequest(&membav1.CompleteQuestRequest{
		AuthToken: token, QuestId: "fix-upstream-bug",
	}))
	if err == nil {
		t.Fatal("expected self_report quest to be rejected by CompleteQuest")
	}

	// XP must remain 0 — nothing was granted.
	resp, _ := h.svc.GetUserQuests(ctx, connect.NewRequest(&membav1.GetUserQuestsRequest{Address: "g1alice"}))
	if resp.Msg.State.TotalXp != 0 {
		t.Fatalf("expected 0 XP after rejected self_report, got %d", resp.Msg.State.TotalXp)
	}
}

// social quests likewise require proof and are not self-completable.
func TestCompleteQuest_RejectsSocial(t *testing.T) {
	h := setup(t)
	token := h.makeToken(t, "g1alice")
	ctx := context.Background()

	_, err := h.svc.CompleteQuest(ctx, connect.NewRequest(&membav1.CompleteQuestRequest{
		AuthToken: token, QuestId: "follow-twitter",
	}))
	if err == nil {
		t.Fatal("expected social quest to be rejected by CompleteQuest")
	}
}

// on_chain quests are granted only when the server-side verifier passes.
func TestCompleteQuest_OnChain_VerifiedViaStub(t *testing.T) {
	h := setup(t)
	h.stubChainVerify(true)
	token := h.makeToken(t, "g1alice")
	ctx := context.Background()

	resp, err := h.svc.CompleteQuest(ctx, connect.NewRequest(&membav1.CompleteQuestRequest{
		AuthToken: token, QuestId: "register-username",
	}))
	if err != nil {
		t.Fatal("CompleteQuest(register-username) with passing verifier:", err)
	}
	if resp.Msg.State.TotalXp != 20 {
		t.Fatalf("expected 20 XP, got %d", resp.Msg.State.TotalXp)
	}
}

// on_chain quests are rejected when the verifier says the condition isn't met.
func TestCompleteQuest_OnChain_RejectedWhenNotMet(t *testing.T) {
	h := setup(t)
	h.stubChainVerify(false)
	token := h.makeToken(t, "g1alice")
	ctx := context.Background()

	_, err := h.svc.CompleteQuest(ctx, connect.NewRequest(&membav1.CompleteQuestRequest{
		AuthToken: token, QuestId: "register-username",
	}))
	if err == nil {
		t.Fatal("expected on_chain quest to be rejected when verifier returns false")
	}
}

// on_chain quests with no registered server verifier are NOT grantable — they
// stay "coming soon" until a verifier lands. Uses the real default verifier
// (no stub) with an unregistered deploy quest, which returns false WITHOUT a
// network call (default switch falls through to false).
func TestCompleteQuest_OnChain_NoVerifier_Rejected(t *testing.T) {
	h := setup(t)
	// vote-proposal is on_chain with no server verifier (and not a deploy quest),
	// so it hits the default switch arm: false, without any network call. Uses a
	// well-formed address so it passes the addr guard first.
	token := h.makeToken(t, "g1abcdefghijklmnopqrstuvwxyz0123456789ab")
	ctx := context.Background()

	_, err := h.svc.CompleteQuest(ctx, connect.NewRequest(&membav1.CompleteQuestRequest{
		AuthToken: token, QuestId: "vote-proposal",
	}))
	if err == nil {
		t.Fatal("expected on_chain quest without a server verifier to be rejected")
	}
}

// ── Deploy-quest verification ───────────────────────────────

func TestNamespaceOf(t *testing.T) {
	cases := []struct {
		in, ns string
		ok     bool
	}{
		{"gno.land/r/alice/myrealm", "alice", true},
		{"gno.land/p/bob_dev/utils", "bob_dev", true},
		{"gno.land/r/al-ice/my-realm", "al-ice", true}, // hyphens allowed
		{"gno.land/r/alice/sub/deep", "alice", true},
		{"gno.land/r/alice", "", false},     // no realm segment
		{"gno.land/x/alice/foo", "", false}, // not r/ or p/
		{"http://evil/r/alice/foo", "", false},
		{"", "", false},
		{`gno.land/r/a"b/foo`, "", false}, // quote -> no match (injection-safe)
	}
	for _, c := range cases {
		ns, ok := namespaceOf(c.in)
		if ok != c.ok || ns != c.ns {
			t.Errorf("namespaceOf(%q) = (%q,%v), want (%q,%v)", c.in, ns, ok, c.ns, c.ok)
		}
	}
}

func TestProofUsedForOtherDeploy(t *testing.T) {
	h := setup(t)
	ctx := context.Background()
	now := time.Now().UTC().Format(time.RFC3339)
	if _, err := h.db.ExecContext(ctx,
		`INSERT INTO quest_completions (address, quest_id, completed_at, proof) VALUES (?,?,?,?)`,
		"g1alice", "deploy-hello-pkg", now, "gno.land/r/alice/foo"); err != nil {
		t.Fatal(err)
	}

	// Same path for a DIFFERENT deploy quest -> already used.
	used, err := h.svc.proofUsedForOtherDeploy(ctx, "g1alice", "deploy-counter-pkg", "gno.land/r/alice/foo")
	if err != nil {
		t.Fatal(err)
	}
	if !used {
		t.Fatal("expected path already used for another deploy quest")
	}
	// A fresh path -> not used.
	if used, _ := h.svc.proofUsedForOtherDeploy(ctx, "g1alice", "deploy-counter-pkg", "gno.land/r/alice/bar"); used {
		t.Fatal("a fresh path should not be 'used'")
	}
	// Same quest id (re-verify) -> not "other".
	if used, _ := h.svc.proofUsedForOtherDeploy(ctx, "g1alice", "deploy-hello-pkg", "gno.land/r/alice/foo"); used {
		t.Fatal("same quest id should not count as 'other'")
	}
}

func TestCompleteQuest_Deploy_VerifiesAndStoresProof(t *testing.T) {
	h := setup(t)
	h.stubChainVerify(true) // stub the on-chain namespace/existence verdict
	addr := "g1abcdefghijklmnopqrstuvwxyz0123456789ab"
	token := h.makeToken(t, addr)
	ctx := context.Background()

	resp, err := h.svc.CompleteQuest(ctx, connect.NewRequest(&membav1.CompleteQuestRequest{
		AuthToken: token, QuestId: "deploy-hello-pkg", Proof: "gno.land/r/alice/foo",
	}))
	if err != nil {
		t.Fatal("CompleteQuest(deploy-hello-pkg):", err)
	}
	if resp.Msg.State.TotalXp != 20 {
		t.Fatalf("expected 20 XP, got %d", resp.Msg.State.TotalXp)
	}
	var proof string
	if err := h.db.QueryRowContext(ctx,
		`SELECT proof FROM quest_completions WHERE address=? AND quest_id=?`,
		addr, "deploy-hello-pkg").Scan(&proof); err != nil {
		t.Fatal(err)
	}
	if proof != "gno.land/r/alice/foo" {
		t.Fatalf("expected stored proof, got %q", proof)
	}
}

func TestCompleteQuest_Deploy_RejectedWithoutProof(t *testing.T) {
	h := setup(t)
	// No stub -> real verifyDeployQuest; empty proof -> canonicalizeProof fails ->
	// reject with no network call.
	token := h.makeToken(t, "g1abcdefghijklmnopqrstuvwxyz0123456789ab")
	ctx := context.Background()
	_, err := h.svc.CompleteQuest(ctx, connect.NewRequest(&membav1.CompleteQuestRequest{
		AuthToken: token, QuestId: "deploy-hello-pkg", Proof: "",
	}))
	if err == nil {
		t.Fatal("expected deploy quest with no proof to be rejected")
	}
}

// C1 regression: a single realm's string aliases must collapse to ONE dedup key,
// so one deploy can't farm multiple deploy quests.
func TestCanonicalizeProof(t *testing.T) {
	const canon = "gno.land/r/alice/foo"
	for _, in := range []string{
		"gno.land/r/alice/foo",
		"gno.land/r/alice/foo/",
		"gno.land/r/alice/foo//",
		"  gno.land/r/alice/foo  ",
		"gno.land/r/alice/foo/render.gno",
		"gno.land/r/alice/foo/gnomod.toml",
		"gno.land/r/alice//foo",
	} {
		if got, ok := canonicalizeProof(in); !ok || got != canon {
			t.Errorf("canonicalizeProof(%q) = (%q,%v), want (%q,true)", in, got, ok, canon)
		}
	}
	for _, in := range []string{
		"", "gno.land/r/alice", "gno.land/x/alice/foo",
		"http://evil/r/alice/foo", `gno.land/r/a"b/foo`,
	} {
		if got, ok := canonicalizeProof(in); ok {
			t.Errorf("canonicalizeProof(%q) = (%q,true), want invalid", in, got)
		}
	}
	if got, ok := canonicalizeProof("gno.land/p/bob_dev/utils/math/"); !ok || got != "gno.land/p/bob_dev/utils/math" {
		t.Errorf("subpkg: got (%q,%v)", got, ok)
	}
	if got, ok := canonicalizeProof("gno.land/r/al-ice/my-realm/"); !ok || got != "gno.land/r/al-ice/my-realm" {
		t.Errorf("hyphen: got (%q,%v)", got, ok)
	}
}

func TestProofUsedForOtherDeploy_CanonicalVariants(t *testing.T) {
	h := setup(t)
	ctx := context.Background()
	now := time.Now().UTC().Format(time.RFC3339)
	if _, err := h.db.ExecContext(ctx,
		`INSERT INTO quest_completions (address, quest_id, completed_at, proof) VALUES (?,?,?,?)`,
		"g1alice", "deploy-hello-pkg", now, "gno.land/r/alice/foo"); err != nil {
		t.Fatal(err)
	}
	canon, ok := canonicalizeProof("gno.land/r/alice/foo/render.gno")
	if !ok {
		t.Fatal("expected variant to canonicalize")
	}
	used, err := h.svc.proofUsedForOtherDeploy(ctx, "g1alice", "deploy-counter-pkg", canon)
	if err != nil {
		t.Fatal(err)
	}
	if !used {
		t.Fatal("a different deploy quest using an alias of the same realm must be blocked")
	}
}

// off_chain quests remain low-trust accepts (documented trade-off, low XP).
func TestCompleteQuest_OffChainAccepted(t *testing.T) {
	h := setup(t)
	token := h.makeToken(t, "g1alice")
	ctx := context.Background()

	resp, err := h.svc.CompleteQuest(ctx, connect.NewRequest(&membav1.CompleteQuestRequest{
		AuthToken: token, QuestId: "use-cmdk",
	}))
	if err != nil {
		t.Fatal("CompleteQuest(use-cmdk):", err)
	}
	if resp.Msg.State.TotalXp != 10 {
		t.Fatalf("expected 10 XP, got %d", resp.Msg.State.TotalXp)
	}
}

// SyncQuests applies the same gate: unverifiable/self_report entries are
// skipped, valid off_chain ones imported.
func TestSyncQuests_SkipsUnverifiable(t *testing.T) {
	h := setup(t)
	h.stubChainVerify(false) // on_chain entries will be skipped
	token := h.makeToken(t, "g1alice")
	ctx := context.Background()

	resp, err := h.svc.SyncQuests(ctx, connect.NewRequest(&membav1.SyncQuestsRequest{
		AuthToken: token,
		Completions: []*membav1.QuestCompletion{
			{QuestId: "connect-wallet"},     // off_chain -> imported
			{QuestId: "fix-upstream-bug"},   // self_report -> skipped
			{QuestId: "register-username"},  // on_chain, verifier false -> skipped
		},
	}))
	if err != nil {
		t.Fatal("SyncQuests:", err)
	}
	if resp.Msg.State.TotalXp != 10 {
		t.Fatalf("expected 10 XP (only connect-wallet), got %d", resp.Msg.State.TotalXp)
	}
	if len(resp.Msg.State.Completed) != 1 {
		t.Fatalf("expected 1 completion, got %d", len(resp.Msg.State.Completed))
	}
}
