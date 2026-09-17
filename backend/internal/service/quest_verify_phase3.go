package service

import (
	"context"
	"log/slog"
	"regexp"
	"strconv"
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

// ── join-dao ────────────────────────────────────────────

// membaDAOMembersPageSize is basedao RenderMembersTable's fixed page size.
const membaDAOMembersPageSize = 10

// maxJoinDAOMemberPages bounds how many :members pages one verification walks
// (one ABCI call each).
const maxJoinDAOMemberPages = 50

var (
	// membersHeaderRe is the realm-written first line of the members page.
	membersHeaderRe = regexp.MustCompile(`^## Members 👥 \((\d+)\)$`)
	// memberRowTailRe matches the realm-generated end of one members-table row:
	//   | [<short>](/u/<addr>) | <role links> | [View](/r/samcrew/memba_dao:member/<addr>) |
	// The display name before it is free text and is never read. The role cell
	// holds no "|", so on any line only the realm-generated tail can match.
	memberRowTailRe = regexp.MustCompile(`\| \[[^\]|\n]*\]\(/u/(g1[a-z0-9]{38})\) \| [^|\n]* \| \[View\]\(/r/samcrew/memba_dao:member/(g1[a-z0-9]{38})\) \|$`)
)

// parseMembaDAOMembersPage reads one memba_dao :members page. It returns the
// realm's total member count and the member addresses listed on this page.
//
// A row counts only from its realm-written tail, with the address cell link and
// the member link naming the same address. Display names are free text and may
// contain line breaks or table markup, so the page is accepted only when its
// row count is consistent with the realm's member count (ok is false otherwise,
// or when the header is missing). The caller checks the exact per-page count.
func parseMembaDAOMembersPage(render string) (total int, addrs []string, ok bool) {
	lines := strings.Split(strings.TrimLeft(render, "\n"), "\n")
	if len(lines) == 0 {
		return 0, nil, false
	}
	m := membersHeaderRe.FindStringSubmatch(strings.TrimSpace(lines[0]))
	if m == nil {
		return 0, nil, false
	}
	total, err := strconv.Atoi(m[1])
	if err != nil || total < 0 {
		return 0, nil, false
	}
	for _, line := range lines[1:] {
		rm := memberRowTailRe.FindStringSubmatch(strings.TrimRight(line, " \r"))
		if rm == nil {
			continue
		}
		if rm[1] != rm[2] {
			return 0, nil, false
		}
		addrs = append(addrs, rm[1])
	}
	if len(addrs) > membaDAOMembersPageSize || len(addrs) > total {
		return 0, nil, false
	}
	return total, addrs, true
}

// expectedRowsOnPage is how many rows basedao renders on 1-based page p.
func expectedRowsOnPage(total, p int) int {
	n := total - (p-1)*membaDAOMembersPageSize
	if n < 0 {
		return 0
	}
	if n > membaDAOMembersPageSize {
		return membaDAOMembersPageSize
	}
	return n
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

// verifyJoinDAO confirms addr is a member of memba_dao by walking every page
// of its :members table and reading addresses only from realm-written row
// cells. A page whose row count differs from what the realm's member count
// implies is not trusted, and verification returns false. addr is
// caller-validated against addrRe.
func verifyJoinDAO(ctx context.Context, addr string) (bool, error) {
	total := -1
	for p := 1; p <= maxJoinDAOMemberPages; p++ {
		arg := "members"
		if p > 1 {
			arg = "members?page=" + strconv.Itoa(p)
		}
		out, err := questRender(ctx, membaDAOPath, arg)
		if err != nil {
			return false, err
		}
		pageTotal, addrs, ok := parseMembaDAOMembersPage(out)
		if !ok {
			if p > 1 {
				slog.Warn("join-dao: members page not trusted", "page", p)
			}
			return false, nil
		}
		if total == -1 {
			total = pageTotal
		}
		if pageTotal != total || len(addrs) != expectedRowsOnPage(total, p) {
			slog.Warn("join-dao: members page row count mismatch", "page", p, "rows", len(addrs), "total", total)
			return false, nil
		}
		for _, a := range addrs {
			if a == addr {
				return true, nil
			}
		}
		if p*membaDAOMembersPageSize >= total {
			return false, nil
		}
	}
	slog.Warn("join-dao: members table exceeds the page walk cap", "total", total)
	return false, nil
}

// verifyCreateToken confirms addr created (is the Admin of) at least one token in
// the factory: it lists the factory's tokens, then checks each token-detail page's
// **Admin** field. Bounded by maxFactoryTokensToScan. A chain error propagates so
// the caller fails closed (CodeFailedPrecondition) rather than denying falsely.
func verifyCreateToken(ctx context.Context, addr string) (bool, error) {
	home, err := questRender(ctx, tokenFactoryPath, "")
	if err != nil {
		return false, err
	}
	for _, sym := range parseFactorySymbols(home) {
		detail, err := questRender(ctx, tokenFactoryPath, sym)
		if err != nil {
			return false, err
		}
		if tokenAdminIs(detail, addr) {
			return true, nil
		}
	}
	return false, nil
}
