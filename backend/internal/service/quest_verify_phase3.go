package service

import (
	"regexp"
	"strings"
)

// Phase 3 on-chain verifiers for the previously-deferred "spoofable" quests.
// These replace substring-scan checks with STRUCTURED render parsing anchored to
// authoritative fields, so a realm that merely echoes an attacker-controlled
// address can't satisfy them. The user's address comes from the verified auth
// token (caller-validated against addrRe), never from client-supplied input.

const (
	membaDAOPath     = "gno.land/r/samcrew/memba_dao"
	tokenFactoryPath = "gno.land/r/samcrew/tokenfactory_v2"
)

// maxFactoryTokensToScan bounds how many factory tokens create-token verification
// will detail-query (one ABCI call each), so a large factory can't fan out
// unbounded RPC per completion attempt.
const maxFactoryTokensToScan = 100

// ── join-dao ────────────────────────────────────────────────

// memberLinked reports whether addr appears in the memba_dao :members render as
// an actual member — i.e. inside a member-context link (`/u/<addr>` profile link
// or `:member/<addr>` detail link), NOT merely as a bare substring. The members
// render only emits those links for real members, so this is un-spoofable: a
// realm echoing an address as prose (the old substring-scan weakness) won't match.
func memberLinked(render, addr string) bool {
	return strings.Contains(render, "/u/"+addr) ||
		strings.Contains(render, ":member/"+addr)
}

// ── create-token ────────────────────────────────────────────

var (
	// $SYMBOL display convention, e.g. "($FOO)".
	factorySymbolRe = regexp.MustCompile(`\$([A-Z][A-Z0-9]*)\)`)
	// Per-token page link, e.g. "tokenfactory_v2:FOO".
	factoryLinkRe = regexp.MustCompile(`tokenfactory_v2:([A-Z][A-Z0-9]*)`)
	// The token-detail page's authoritative creator/admin field.
	tokenAdminRe = regexp.MustCompile(`\*\*Admin\*\*:\s*(g1[a-z0-9]+)`)
)

// parseFactorySymbols extracts distinct token symbols from the factory home
// render — both the "$SYM" display form and the ":SYM" page-link form, unioned
// and deduped in appearance order, capped at maxFactoryTokensToScan. NOTE: the
// tokenfactory_v2 with-tokens format is live-unverified (the factory is empty on
// test13); this mirrors the frontend's known factory format and is validated by
// the gated live test once a real token exists.
func parseFactorySymbols(home string) []string {
	seen := make(map[string]bool)
	out := []string{}
	for _, re := range []*regexp.Regexp{factorySymbolRe, factoryLinkRe} {
		for _, m := range re.FindAllStringSubmatch(home, -1) {
			sym := m[1]
			if seen[sym] {
				continue
			}
			seen[sym] = true
			out = append(out, sym)
			if len(out) >= maxFactoryTokensToScan {
				return out
			}
		}
	}
	return out
}

// tokenAdminIs reports whether the token-detail render names addr as its Admin
// (the on-chain creator), matched as the typed **Admin** field rather than a raw
// substring — so a token name/description echoing an address can't false-positive.
func tokenAdminIs(detail, addr string) bool {
	m := tokenAdminRe.FindStringSubmatch(detail)
	return m != nil && m[1] == addr
}

// ── on-chain orchestrators (called from defaultVerifyOnChainQuest) ──

// verifyJoinDAO confirms addr is a member of memba_dao by parsing its
// authoritative :members render. addr is caller-validated against addrRe.
// NOTE: queries the members page once; memba_dao lists all members inline (no
// pagination today). Revisit if membership ever grows past a single page.
func verifyJoinDAO(addr string) (bool, error) {
	out, err := questRender(membaDAOPath, "members")
	if err != nil {
		return false, err
	}
	return memberLinked(out, addr), nil
}

// verifyCreateToken confirms addr created (is the Admin of) at least one token in
// the factory: it lists the factory's tokens, then checks each token-detail page's
// **Admin** field. Bounded by maxFactoryTokensToScan. A chain error propagates so
// the caller fails closed (CodeFailedPrecondition) rather than denying falsely.
func verifyCreateToken(addr string) (bool, error) {
	home, err := questRender(tokenFactoryPath, "")
	if err != nil {
		return false, err
	}
	for _, sym := range parseFactorySymbols(home) {
		detail, err := questRender(tokenFactoryPath, sym)
		if err != nil {
			return false, err
		}
		if tokenAdminIs(detail, addr) {
			return true, nil
		}
	}
	return false, nil
}
