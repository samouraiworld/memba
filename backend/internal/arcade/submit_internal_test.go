package arcade

import (
	"testing"
	"time"
)

// White-box tests for the seed grammar — the ONLY authority on which game a
// submission belongs to (a client-sent game field is never trusted).

func grammarNow() time.Time { return time.Date(2026, 7, 13, 12, 0, 0, 0, time.UTC) }

func TestDeriveGameModeDay_AllGrammars(t *testing.T) {
	ok := []struct {
		seed            string
		game, mode, day string
	}{
		// BARRICADE daily: today and yesterday (the live window).
		{"barricade-2026-07-13", "barricade", "daily", "2026-07-13"},
		{"barricade-2026-07-12", "barricade", "daily", "2026-07-12"},
		// BARRICADE practice: the pre-multigame seed shape, grandfathered
		// verbatim (existing clients keep working unchanged).
		{"practice-1720000000000-3", "barricade", "practice", "2026-07-13"},
		// Space Invaders practice MUST win over the invaders daily rule
		// (prefix precedence): "invaders-practice-…" is not a malformed daily.
		{"invaders-practice-1720000000000-3", "invaders", "practice", "2026-07-13"},
		{"invaders-2026-07-13", "invaders", "daily", "2026-07-13"},
		{"invaders-2026-07-12", "invaders", "daily", "2026-07-12"},
	}
	for _, c := range ok {
		game, mode, day, err := deriveGameModeDay(c.seed, grammarNow())
		if err != nil {
			t.Errorf("%q: unexpected error %v", c.seed, err)
			continue
		}
		if game != c.game || mode != c.mode || day != c.day {
			t.Errorf("%q: got (%s, %s, %s), want (%s, %s, %s)", c.seed, game, mode, day, c.game, c.mode, c.day)
		}
	}

	bad := map[string]string{
		"unknown prefix":            "evil-seed",
		"bare game":                 "invaders",
		"barricade future":          "barricade-2030-01-01",
		"barricade stale":           "barricade-2026-07-01",
		"invaders future":           "invaders-2030-01-01",
		"invaders stale":            "invaders-2026-07-01",
		"invaders malformed date":   "invaders-2026-7-13",
		"invaders trailing junk":    "invaders-2026-07-13x",
		"invaders impossible date":  "invaders-2026-13-45",
		"barricade malformed date":  "barricade-late",
		"barricade impossible date": "barricade-2026-02-31",
	}
	for name, seed := range bad {
		if _, _, _, err := deriveGameModeDay(seed, grammarNow()); err == nil {
			t.Errorf("%s: expected rejection for seed %q", name, seed)
		}
	}
}

func TestDeriveGameModeDay_WindowIsSharedAcrossGames(t *testing.T) {
	// The live window is UTC-day based for every game: at 00:30 UTC the
	// previous UTC day is still submittable, two days back is not.
	at := time.Date(2026, 7, 13, 0, 30, 0, 0, time.UTC)
	for _, seed := range []string{"barricade-2026-07-12", "invaders-2026-07-12"} {
		if _, _, _, err := deriveGameModeDay(seed, at); err != nil {
			t.Errorf("%q: yesterday must be in the window, got %v", seed, err)
		}
	}
	for _, seed := range []string{"barricade-2026-07-11", "invaders-2026-07-11"} {
		if _, _, _, err := deriveGameModeDay(seed, at); err == nil {
			t.Errorf("%q: two days back must be out of the window", seed)
		}
	}
}

func TestParseEnabledGames(t *testing.T) {
	// Unset/empty → the BARRICADE-only status quo (the dark-by-default pin for
	// every other game).
	for _, env := range []string{"", "  ", ","} {
		got := ParseEnabledGames(env)
		if !got["barricade"] || len(got) != 1 {
			t.Fatalf("ParseEnabledGames(%q) = %v, want barricade only", env, got)
		}
	}
	got := ParseEnabledGames(" Barricade , invaders ")
	if !got["barricade"] || !got["invaders"] || len(got) != 2 {
		t.Fatalf("ParseEnabledGames = %v, want both games (normalized)", got)
	}
	// enabledGame honors the set — and treats nil as the barricade default.
	if !enabledGame(nil, gameBarricade) || enabledGame(nil, gameInvaders) {
		t.Fatal("nil set must mean barricade-only")
	}
	if !enabledGame(got, gameInvaders) {
		t.Fatal("an explicitly-listed game must be enabled")
	}
}

func TestStatsFor(t *testing.T) {
	// The worker authors invaders stats; they pass through verbatim.
	inv := Result{OK: true, Stats: `{"wave":3,"shots":50,"hits":20}`}
	if got := statsFor(gameInvaders, inv); got != inv.Stats {
		t.Fatalf("invaders stats must pass through, got %q", got)
	}
	// BARRICADE's worker output predates stats — the legacy display trio is
	// synthesized so the realm keeps the context AttestScore v1 carried as
	// positional args.
	bar := Result{OK: true, Waves: 7, Won: true, OvertimeRound: 3}
	if got := statsFor(gameBarricade, bar); got != `{"waves":7,"won":true,"overtimeRound":3}` {
		t.Fatalf("barricade stats synthesis wrong: %q", got)
	}
}
