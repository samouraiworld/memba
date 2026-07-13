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

func TestStore_PendingDailyDays(t *testing.T) {
	s := testDB(t)
	insert(t, s, dailyRun("a", "2026-07-10", 100))
	insert(t, s, dailyRun("b", "2026-07-11", 200))
	insert(t, s, dailyRun("c", "2026-07-13", 300)) // "today" — not yet closed

	days, err := s.PendingDailyDays("2026-07-13")
	if err != nil {
		t.Fatalf("pending: %v", err)
	}
	// Only CLOSED days (< 2026-07-13) with pending verified runs, ascending.
	if len(days) != 2 || days[0] != "2026-07-10" || days[1] != "2026-07-11" {
		t.Fatalf("expected [2026-07-10 2026-07-11], got %v", days)
	}
}

func TestStore_PendingDailyDays_ExcludesAttestedAndPractice(t *testing.T) {
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

	days, err := s.PendingDailyDays("2026-07-13")
	if err != nil {
		t.Fatalf("pending: %v", err)
	}
	if len(days) != 0 {
		t.Fatalf("a fully-attested + practice-only day must not be pending, got %v", days)
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

	top, err := s.BestVerifiedDaily("2026-07-10", 2)
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
	top, err := s.BestVerifiedDaily("2026-07-10", 10)
	if err != nil {
		t.Fatalf("best: %v", err)
	}
	if len(top) != 1 || top[0].LogHash != "hi" {
		t.Fatalf("one address must yield only its best run, got %+v", top)
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
