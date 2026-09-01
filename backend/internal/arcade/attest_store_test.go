package arcade_test

import (
	"testing"

	_ "modernc.org/sqlite"

	"github.com/samouraiworld/memba/backend/internal/arcade"
)

func insert(t *testing.T, s *arcade.Store, r arcade.Run) {
	t.Helper()
	if err := s.InsertRun(r); err != nil {
		t.Fatalf("insert %s: %v", r.LogHash, err)
	}
}

func dailyRun(logHash, day string, score int64) arcade.Run {
	return arcade.Run{
		LogHash: logHash, Addr: "g1" + logHash, Day: day, Mode: "daily",
		Seed: "barricade-" + day, SimVersion: 2, Score: score, Waves: 5,
		StateHash: "sh" + logHash, Events: "[]", Status: "verified", CreatedAt: 1,
	}
}

func TestStore_PendingDailyGameDays(t *testing.T) {
	s := testDB(t)
	insert(t, s, dailyRun("a", "2026-07-10", 100))
	insert(t, s, dailyRun("b", "2026-07-11", 200))
	insert(t, s, dailyRun("c", "2026-07-13", 300)) // "today" — not yet closed
	// A second game on an already-pending day is its own board.
	inv := dailyRun("i", "2026-07-10", 50)
	inv.Game = "invaders"
	insert(t, s, inv)

	boards, err := s.PendingDailyGameDays("2026-07-13")
	if err != nil {
		t.Fatalf("pending: %v", err)
	}
	// Only CLOSED days (< 2026-07-13) with pending verified runs, day-ascending
	// (game breaking ties) — and one entry PER (game, day), not per day.
	want := []arcade.GameDay{
		{Game: "barricade", Day: "2026-07-10"},
		{Game: "invaders", Day: "2026-07-10"},
		{Game: "barricade", Day: "2026-07-11"},
	}
	if len(boards) != len(want) {
		t.Fatalf("expected %v, got %v", want, boards)
	}
	for i := range want {
		if boards[i] != want[i] {
			t.Fatalf("expected %v, got %v", want, boards)
		}
	}
}

func TestStore_PendingDailyGameDays_ExcludesAttestedAndPractice(t *testing.T) {
	s := testDB(t)
	insert(t, s, dailyRun("done", "2026-07-10", 100))
	if err := s.MarkAttested("done", "tx1", 42); err != nil {
		t.Fatalf("mark: %v", err)
	}
	// A practice run on a closed day must NOT make the day pending (practice isn't
	// the competitive board).
	prac := dailyRun("prac", "2026-07-10", 100)
	prac.Mode = "practice"
	insert(t, s, prac)

	boards, err := s.PendingDailyGameDays("2026-07-13")
	if err != nil {
		t.Fatalf("pending: %v", err)
	}
	if len(boards) != 0 {
		t.Fatalf("a fully-attested + practice-only day must not be pending, got %v", boards)
	}
}

func TestStore_BestVerifiedDaily_RanksAndLimits(t *testing.T) {
	s := testDB(t)
	// dailyRun gives each its own address, so best-per-address == every run.
	insert(t, s, dailyRun("low", "2026-07-10", 100))
	insert(t, s, dailyRun("high", "2026-07-10", 900))
	insert(t, s, dailyRun("mid", "2026-07-10", 500))
	attested := dailyRun("att", "2026-07-10", 999) // highest but already attested — excluded
	insert(t, s, attested)
	if err := s.MarkAttested("att", "tx", 1); err != nil {
		t.Fatalf("mark: %v", err)
	}

	top, err := s.BestVerifiedDaily("barricade", "2026-07-10", 2)
	if err != nil {
		t.Fatalf("top: %v", err)
	}
	if len(top) != 2 || top[0].LogHash != "high" || top[1].LogHash != "mid" {
		t.Fatalf("expected [high mid] by score desc, got %+v", top)
	}
}

func TestStore_BestVerifiedDaily_OnePerAddress(t *testing.T) {
	s := testDB(t)
	// One address, two runs: only the higher score is returned.
	insert(t, s, arcade.Run{LogHash: "lo", Addr: "g1x", Day: "2026-07-10", Mode: "daily", Seed: "s", SimVersion: 2, Score: 100, StateHash: "h1", Events: "[]", Status: "verified", CreatedAt: 1})
	insert(t, s, arcade.Run{LogHash: "hi", Addr: "g1x", Day: "2026-07-10", Mode: "daily", Seed: "s", SimVersion: 2, Score: 800, StateHash: "h2", Events: "[]", Status: "verified", CreatedAt: 2})
	top, err := s.BestVerifiedDaily("barricade", "2026-07-10", 10)
	if err != nil {
		t.Fatalf("best: %v", err)
	}
	if len(top) != 1 || top[0].LogHash != "hi" {
		t.Fatalf("one address must yield only its best run, got %+v", top)
	}
}

func TestStore_CrossGameIsolation(t *testing.T) {
	// The same wallet, the same day, two games: two INDEPENDENT boards. Each
	// game's best-per-address is its own row; scoring high in one game must
	// never collapse (or shadow) the wallet's entry in the other; and the
	// superseded sweep for one game's board must not touch the other's runs.
	s := testDB(t)
	bar := arcade.Run{LogHash: "bar1", Addr: "g1x", Game: "barricade", Day: "2026-07-10", Mode: "daily",
		Seed: "barricade-2026-07-10", SimVersion: 2, Score: 900, StateHash: "hb", Events: "[]", Status: "verified", CreatedAt: 1}
	invHi := arcade.Run{LogHash: "inv_hi", Addr: "g1x", Game: "invaders", Day: "2026-07-10", Mode: "daily",
		Seed: "invaders-2026-07-10", SimVersion: 1, Score: 500, Stats: `{"wave":4,"shots":80,"hits":33}`, StateHash: "hi1", Events: "[]", Status: "verified", CreatedAt: 2}
	invLo := arcade.Run{LogHash: "inv_lo", Addr: "g1x", Game: "invaders", Day: "2026-07-10", Mode: "daily",
		Seed: "invaders-2026-07-10", SimVersion: 1, Score: 100, StateHash: "hi2", Events: "[]", Status: "verified", CreatedAt: 3}
	for _, r := range []arcade.Run{bar, invHi, invLo} {
		insert(t, s, r)
	}

	barTop, err := s.BestVerifiedDaily("barricade", "2026-07-10", 10)
	if err != nil {
		t.Fatalf("barricade best: %v", err)
	}
	if len(barTop) != 1 || barTop[0].LogHash != "bar1" || barTop[0].Game != "barricade" {
		t.Fatalf("barricade board wrong: %+v", barTop)
	}
	invTop, err := s.BestVerifiedDaily("invaders", "2026-07-10", 10)
	if err != nil {
		t.Fatalf("invaders best: %v", err)
	}
	if len(invTop) != 1 || invTop[0].LogHash != "inv_hi" || invTop[0].Game != "invaders" {
		t.Fatalf("invaders board wrong: %+v", invTop)
	}
	// The stored stats round-trips (it's the canonical on-chain payload).
	if invTop[0].Stats != `{"wave":4,"shots":80,"hits":33}` {
		t.Fatalf("stats did not round-trip: %q", invTop[0].Stats)
	}

	// Retiring the wallet's superseded INVADERS runs must not touch its
	// barricade run (game-scoped predicate).
	if err := s.ResolveSupersededDaily("invaders", "2026-07-10", "g1x", "inv_hi"); err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if r, _, _ := s.GetRunByLogHash("inv_lo"); r.Status != "skipped" {
		t.Fatalf("inv_lo must be 'skipped', got %q", r.Status)
	}
	if r, _, _ := s.GetRunByLogHash("bar1"); r.Status != "verified" {
		t.Fatalf("the other game's run must be untouched, got %q", r.Status)
	}
}

func TestStore_MarkAttested(t *testing.T) {
	s := testDB(t)
	insert(t, s, dailyRun("x", "2026-07-10", 100))
	if err := s.MarkAttested("x", "0xTX", 12345); err != nil {
		t.Fatalf("mark: %v", err)
	}
	got, _, _ := s.GetRunByLogHash("x")
	if got.Status != "attested" || got.AttestedTxHash != "0xTX" || got.AttestedAt != 12345 {
		t.Fatalf("mark did not persist: %+v", got)
	}
	// Idempotent-ish: marking again is not an error (re-attest guard is the query).
	if err := s.MarkAttested("x", "0xTX2", 2); err != nil {
		t.Fatalf("second mark: %v", err)
	}
}
