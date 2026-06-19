package service

import "testing"

// Gated live checks for the Phase 3 on-chain verifiers against real test13.
// Kept hermetic in CI via requireLiveRPC (set MEMBA_LIVE_RPC=1 to run). These
// confirm the parsers match the LIVE render formats — the un-spoofable-check
// equivalent of #438's manual ResolveName probe.
//
//	MEMBA_LIVE_RPC=1 go test ./internal/service/ -run Live -v

// membaDAOLiveMember is the lone memba_dao member on test13 (the samcrew
// multisig). ResolveName("samcrew") resolves to this same address.
const membaDAOLiveMember = "g1x7k4628w93a7wzdhqc06atzx0v50rnshweuxu0"

func TestLive_JoinDAO_DetectsRealMember(t *testing.T) {
	requireLiveRPC(t)
	ok, err := verifyJoinDAO(membaDAOLiveMember)
	if err != nil {
		t.Fatalf("verifyJoinDAO(member): %v", err)
	}
	if !ok {
		t.Fatal("the live memba_dao member must verify as a DAO member")
	}
}

func TestLive_JoinDAO_RejectsNonMember(t *testing.T) {
	requireLiveRPC(t)
	// Well-formed but not a member of memba_dao.
	ok, err := verifyJoinDAO("g1abcdefghijklmnopqrstuvwxyz0123456789ab")
	if err != nil {
		t.Fatalf("verifyJoinDAO(non-member): %v", err)
	}
	if ok {
		t.Fatal("a non-member address must not verify as a DAO member")
	}
}

func TestLive_CreateToken_EmptyFactoryDeniesCleanly(t *testing.T) {
	requireLiveRPC(t)
	// tokenfactory_v2 has 0 tokens on test13 — verification must parse the live
	// home render and return (false, nil): no false credit, no error, no bogus
	// symbol detail-query. Extend to assert a real creator once a token exists.
	ok, err := verifyCreateToken(membaDAOLiveMember)
	if err != nil {
		t.Fatalf("verifyCreateToken(empty factory): %v", err)
	}
	if ok {
		t.Fatal("an empty token factory must not credit anyone with create-token")
	}
}
