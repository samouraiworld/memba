package service

import (
	"reflect"
	"testing"
)

// ── join-dao: membership detection from the memba_dao :members render ──

func TestMemberLinked(t *testing.T) {
	// A representative memba_dao:members render: each member row links the
	// member's profile (/u/<addr>) and a member-detail page (:member/<addr>).
	const members = "## Members 👥 (1)\n" +
		"| Anon | [g1x7\\.\\.\\.uxu0](/u/g1x7k4628w93a7wzdhqc06atzx0v50rnshweuxu0) " +
		"| [admin](/r/samcrew/memba_dao:role/admin) " +
		"| [View](/r/samcrew/memba_dao:member/g1x7k4628w93a7wzdhqc06atzx0v50rnshweuxu0) |"
	member := "g1x7k4628w93a7wzdhqc06atzx0v50rnshweuxu0"
	nonmember := "g1abcdefghijklmnopqrstuvwxyz0123456789ab"

	if !memberLinked(members, member) {
		t.Error("a listed member (present in /u/ and :member/ links) must be detected")
	}
	if memberLinked(members, nonmember) {
		t.Error("an address absent from the members render must not be detected")
	}

	// Spoof-resistance: an address echoed only as bare prose text (NOT inside a
	// member link) must NOT count — this is what made a raw substring scan
	// spoofable (a realm could echo an attacker-controlled address).
	const prose = "> Realm address: g1dmaqdpwr6xw6ukday0g66033j6ta4wc0r5ypf8\n" +
		"see also g1abcdefghijklmnopqrstuvwxyz0123456789ab in passing"
	if memberLinked(prose, nonmember) {
		t.Error("a bare-text address with no member link must not count as membership")
	}
}

// ── create-token: token symbols + per-token admin (creator) attribution ──

func TestParseFactorySymbols(t *testing.T) {
	// Inferred tokenfactory_v2 home format (per-token pages linked as :SYMBOL;
	// $SYMBOL display convention). NOTE: speculative — live-unverified (factory
	// is empty on test13); validated by the gated live test once a token exists.
	const home = "# Samcrew Token Factory (2 tokens)\n" +
		"- [Foo Coin ($FOO)](/r/samcrew/tokenfactory_v2:FOO)\n" +
		"- [Bar ($BAR)](/r/samcrew/tokenfactory_v2:BAR)"
	got := parseFactorySymbols(home)
	if want := []string{"FOO", "BAR"}; !reflect.DeepEqual(got, want) {
		t.Errorf("parseFactorySymbols = %v, want %v", got, want)
	}

	if got := parseFactorySymbols("# Samcrew Token Factory (0 tokens)"); len(got) != 0 {
		t.Errorf("empty factory must yield no symbols, got %v", got)
	}

	// A symbol appearing in both the $display and the :link must dedupe to one.
	const dup = "- [Zap ($ZAP)](/r/samcrew/tokenfactory_v2:ZAP)"
	if got := parseFactorySymbols(dup); !reflect.DeepEqual(got, []string{"ZAP"}) {
		t.Errorf("duplicate symbol must collapse, got %v", got)
	}

	// Cap: never emit more than maxFactoryTokensToScan (bounds per-token RPCs).
	var big string
	for i := 0; i < maxFactoryTokensToScan+20; i++ {
		big += "(/r/samcrew/tokenfactory_v2:T" + itoaPad(i) + ")\n"
	}
	if got := parseFactorySymbols(big); len(got) != maxFactoryTokensToScan {
		t.Errorf("symbol list must be capped at %d, got %d", maxFactoryTokensToScan, len(got))
	}
}

func TestTokenAdminIs(t *testing.T) {
	const detail = "# Foo ($FOO)\n\n" +
		"* **Decimals**: 4\n* **Total supply**: 10000\n" +
		"* **Admin**: g1x7k4628w93a7wzdhqc06atzx0v50rnshweuxu0\n"
	admin := "g1x7k4628w93a7wzdhqc06atzx0v50rnshweuxu0"
	other := "g1abcdefghijklmnopqrstuvwxyz0123456789ab"

	if !tokenAdminIs(detail, admin) {
		t.Error("the token's Admin address must match")
	}
	if tokenAdminIs(detail, other) {
		t.Error("a non-admin address must not match the Admin field")
	}
	if tokenAdminIs("# Foo ($FOO)\n* **Decimals**: 4", admin) {
		t.Error("a detail render with no Admin field must not match")
	}
}

// itoaPad gives distinct uppercase-safe symbol suffixes for the cap test.
func itoaPad(n int) string {
	const digits = "0123456789"
	if n == 0 {
		return "0"
	}
	var b []byte
	for n > 0 {
		b = append([]byte{digits[n%10]}, b...)
		n /= 10
	}
	return string(b)
}
