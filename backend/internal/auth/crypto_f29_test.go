package auth

import (
	"strings"
	"testing"
	"time"
)

// F-29 — MakeToken minted on the CLIENT-supplied chain-id and never checked it
// against the accepted set, while ValidateToken enforces that set on every
// call. Login therefore succeeded and every subsequent request 401'd, forever,
// because the frontend only clears a token on natural expiry.
//
// The tests below pin BOTH halves: the new rejection, and the fact that every
// configuration which worked before still works. The second half matters more
// than the first — this code path is the front door, and a fix that quietly
// locked out legacy or unconfigured deployments would be worse than the bug.

// The core regression. Reproduces the sapphire-cutover shape exactly: the
// client asks for topaz-1, the server serves only sapphire-1.
func TestMakeToken_F29_RejectsUnservedChainAtMint(t *testing.T) {
	t.Setenv(AllowUnsignedAuthEnv, "1")
	serverPub, serverPriv := generateTestKeypair(t)
	infoJSON := buildEmptySigAuthInfo(t, serverPriv, "topaz-1")

	_, err := MakeToken(serverPriv, serverPub, time.Hour, infoJSON, "", "sapphire-1", "sapphire-1")
	if err == nil {
		t.Fatal("F-29: minting for a chain the server does not serve must fail at issue time, " +
			"not silently succeed and 401 on every later call")
	}
	if !strings.Contains(err.Error(), ChainMismatchCode) {
		t.Fatalf("error must carry %s so the RPC layer can surface it to the UI, got: %v",
			ChainMismatchCode, err)
	}
}

// The token that IS minted must be one ValidateToken will accept. This is the
// invariant whose absence was the bug: issue and validate must agree.
func TestMakeToken_F29_MintedTokenAlwaysValidates(t *testing.T) {
	t.Setenv(AllowUnsignedAuthEnv, "1")
	serverPub, serverPriv := generateTestKeypair(t)
	accepted := []string{"sapphire-1", "topaz-1"}

	for _, chain := range accepted {
		infoJSON := buildEmptySigAuthInfo(t, serverPriv, chain)
		tok, err := MakeToken(serverPriv, serverPub, time.Hour, infoJSON, "", "sapphire-1", accepted...)
		if err != nil {
			t.Fatalf("%s is in the accepted set and must mint: %v", chain, err)
		}
		if err := ValidateToken(serverPub, tok, accepted...); err != nil {
			t.Fatalf("F-29 invariant broken: MakeToken issued a %s token that ValidateToken "+
				"rejects — this is precisely the 401-forever loop: %v", chain, err)
		}
	}
}

// Negative control for the test above: without the fix the mint would succeed
// and this pairing would fail. Proves the suite can actually observe the bug
// rather than passing vacuously.
func TestMakeToken_F29_UnservedChainWouldHaveFailedValidation(t *testing.T) {
	t.Setenv(AllowUnsignedAuthEnv, "1")
	serverPub, serverPriv := generateTestKeypair(t)
	infoJSON := buildEmptySigAuthInfo(t, serverPriv, "topaz-1")

	// Mint with NO accepted set (legacy accept-any) to obtain the token the old
	// code would have produced...
	tok, err := MakeToken(serverPriv, serverPub, time.Hour, infoJSON, "", "topaz-1")
	if err != nil {
		t.Fatalf("legacy accept-any mint must still work: %v", err)
	}
	// ...then show it is rejected by a server that accepts only sapphire-1.
	if err := ValidateToken(serverPub, tok, "sapphire-1"); err == nil {
		t.Fatal("control failed: a topaz-1 token must be rejected by a sapphire-1-only server, " +
			"otherwise these tests prove nothing about F-29")
	}
}

// Legacy client: sends no chain_id at all. effectiveChainID falls back to the
// server default, which parseAcceptedChainIDs guarantees is in the accepted
// set. Must keep working — this is the 24h grace path.
func TestMakeToken_F29_LegacyClientWithoutChainIDStillMints(t *testing.T) {
	t.Setenv(AllowUnsignedAuthEnv, "1")
	serverPub, serverPriv := generateTestKeypair(t)
	infoJSON := buildEmptySigAuthInfo(t, serverPriv, "")

	tok, err := MakeToken(serverPriv, serverPub, time.Hour, infoJSON, "", "topaz-1", "topaz-1")
	if err != nil {
		t.Fatalf("a client that sends no chain_id must still authenticate (grace window): %v", err)
	}
	if tok.ChainId != "topaz-1" {
		t.Fatalf("expected the server default to be recorded on the token, got %q", tok.ChainId)
	}
}

// Unconfigured server (F-29b): an empty accepted set means accept ANY chain,
// matching ValidateToken. Pinned deliberately — this is a real hazard, not a
// desirable default, and NewMultisigService now WARNs about it. If the
// semantics are ever tightened, this test should fail and be changed on
// purpose rather than discovered in production.
func TestMakeToken_F29b_EmptyAcceptedSetAcceptsAnyChain(t *testing.T) {
	t.Setenv(AllowUnsignedAuthEnv, "1")
	serverPub, serverPriv := generateTestKeypair(t)
	// A fresh challenge per call: challenges are single-use, so reusing one
	// infoJSON here fails with "challenge already used" and would look like a
	// chain rejection.
	if _, err := MakeToken(serverPriv, serverPub, time.Hour,
		buildEmptySigAuthInfo(t, serverPriv, "some-unknown-chain"), "", "topaz-1"); err != nil {
		t.Fatalf("empty accepted set is legacy accept-any (mirrors ValidateToken): %v", err)
	}
	// Blank entries must collapse to "unconfigured" rather than to a set
	// containing "" — otherwise a stray comma in MEMBA_ACCEPTED_CHAIN_IDS would
	// lock every user out.
	if _, err := MakeToken(serverPriv, serverPub, time.Hour,
		buildEmptySigAuthInfo(t, serverPriv, "some-unknown-chain"), "", "topaz-1", "", ""); err != nil {
		t.Fatalf("an all-blank accepted set must behave as unconfigured, not as a deny-all: %v", err)
	}
}

// A multi-chain transition window (e.g. serving topaz-1 and sapphire-1 at once
// during the cutover) must let both through. This is how the cutover avoids
// stranding bookmarked users.
func TestMakeToken_F29_TransitionWindowAcceptsBothChains(t *testing.T) {
	t.Setenv(AllowUnsignedAuthEnv, "1")
	serverPub, serverPriv := generateTestKeypair(t)

	for _, chain := range []string{"topaz-1", "sapphire-1"} {
		infoJSON := buildEmptySigAuthInfo(t, serverPriv, chain)
		if _, err := MakeToken(serverPriv, serverPub, time.Hour, infoJSON, "",
			"sapphire-1", "topaz-1", "sapphire-1"); err != nil {
			t.Fatalf("%s must mint during a two-chain transition window: %v", chain, err)
		}
	}
}

func TestNonEmpty_DropsBlanksAndPreservesOrder(t *testing.T) {
	got := nonEmpty([]string{"", "topaz-1", "", "sapphire-1"})
	if len(got) != 2 || got[0] != "topaz-1" || got[1] != "sapphire-1" {
		t.Fatalf("expected [topaz-1 sapphire-1], got %v", got)
	}
	if len(nonEmpty(nil)) != 0 || len(nonEmpty([]string{"", ""})) != 0 {
		t.Fatal("nil and all-blank must both collapse to the unconfigured (len 0) case")
	}
}
