package service

import "testing"

// Gated live checks for #438's deploy-quest namespace-ownership path against real
// test13. These codify the manual ResolveName/qfile probes done when #438 shipped
// so a future r/sys/users or vm/qfile render-format change is caught instead of
// silently breaking deploy-quest verification. Hermetic in CI via requireLiveRPC.
//
//	MEMBA_LIVE_RPC=1 go test ./internal/service/ -run TestLive_Namespace -v

// nsLiveOwner is the samcrew namespace owner on test13 (the multisig); it also
// owns gnobuilders_badges_v2. ResolveName("samcrew") prints it as the typed
// owner field `("<addr>" .uverse.address)`.
const nsLiveOwner = "g1x7k4628w93a7wzdhqc06atzx0v50rnshweuxu0"

func TestLive_NamespaceOwnedBy_MatchesTypedOwnerField(t *testing.T) {
	requireLiveRPC(t)
	s := &MultisigService{} // namespaceOwnedBy uses only questEval, no service state

	ok, err := s.namespaceOwnedBy("samcrew", nsLiveOwner)
	if err != nil {
		t.Fatalf("namespaceOwnedBy(samcrew, owner): %v", err)
	}
	if !ok {
		t.Fatal("samcrew must resolve as owned by the multisig (ResolveName format drift?)")
	}

	// A well-formed but different address must not match samcrew's owner field.
	notOwner, err := s.namespaceOwnedBy("samcrew", "g1abcdefghijklmnopqrstuvwxyz0123456789ab")
	if err != nil {
		t.Fatalf("namespaceOwnedBy(samcrew, other): %v", err)
	}
	if notOwner {
		t.Fatal("a non-owner address must not match the namespace owner")
	}

	// A namespace that doesn't exist resolves to (nil …) — not owned by anyone.
	ghost, err := s.namespaceOwnedBy("namespace_does_not_exist_xyz", nsLiveOwner)
	if err != nil {
		t.Fatalf("namespaceOwnedBy(ghost, owner): %v", err)
	}
	if ghost {
		t.Fatal("a non-existent namespace must not be reported as owned")
	}
}

func TestLive_PathExists_DistinguishesRealAndAbsentRealms(t *testing.T) {
	requireLiveRPC(t)

	exists, err := pathExists("gno.land/r/samcrew/memba_dao")
	if err != nil {
		t.Fatalf("pathExists(memba_dao): %v", err)
	}
	if !exists {
		t.Fatal("a deployed realm must be reported as existing (vm/qfile drift?)")
	}

	absent, err := pathExists("gno.land/r/samcrew/realm_does_not_exist_xyz")
	if err != nil {
		t.Fatalf("pathExists(absent): %v", err)
	}
	if absent {
		t.Fatal("an absent realm path must not be reported as existing")
	}
}
