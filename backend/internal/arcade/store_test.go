package arcade_test

import (
	"errors"
	"testing"

	_ "modernc.org/sqlite"

	"github.com/samouraiworld/memba/backend/internal/arcade"
	"github.com/samouraiworld/memba/backend/internal/db"
)

func testDB(t *testing.T) *arcade.Store {
	t.Helper()
	database, err := db.Open(":memory:")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(func() { _ = database.Close() })
	if err := db.Migrate(database); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	return arcade.NewStore(database)
}

func sampleRun(logHash, addr string) arcade.Run {
	return arcade.Run{
		LogHash: logHash, Addr: addr, Day: "2026-07-13", Mode: "daily",
		Seed: "barricade-2026-07-13", SimVersion: 2, Score: 27150, Waves: 5,
		Won: false, OvertimeRound: 0, StateHash: "e8532dc207e3cb24",
		Events: "[]", Status: "verified", CreatedAt: 1_752_000_000,
	}
}

func TestStore_InsertAndGetByLogHash(t *testing.T) {
	s := testDB(t)
	run := sampleRun("hashA", "g1alice")
	if err := s.InsertRun(run); err != nil {
		t.Fatalf("insert: %v", err)
	}
	got, ok, err := s.GetRunByLogHash("hashA")
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if !ok {
		t.Fatal("expected the run to be found")
	}
	if got.Addr != "g1alice" || got.Score != 27150 || got.StateHash != "e8532dc207e3cb24" || got.Mode != "daily" {
		t.Fatalf("round-trip mismatch: %+v", got)
	}
}

func TestStore_GetMissingReturnsNotFound(t *testing.T) {
	s := testDB(t)
	if _, ok, err := s.GetRunByLogHash("nope"); err != nil || ok {
		t.Fatalf("expected not-found, got ok=%v err=%v", ok, err)
	}
}

func TestStore_DuplicateLogHashIsRejected(t *testing.T) {
	// The input log hash is the realm's replay-theft key: the same log must bind
	// once. A second insert of the same hash (even a different address) must
	// surface ErrDuplicateLog, not silently overwrite or double-count.
	s := testDB(t)
	if err := s.InsertRun(sampleRun("dup", "g1alice")); err != nil {
		t.Fatalf("first insert: %v", err)
	}
	err := s.InsertRun(sampleRun("dup", "g1mallory"))
	if !errors.Is(err, arcade.ErrDuplicateLog) {
		t.Fatalf("expected ErrDuplicateLog, got %v", err)
	}
	// The original owner is preserved.
	got, _, _ := s.GetRunByLogHash("dup")
	if got.Addr != "g1alice" {
		t.Fatalf("duplicate must not overwrite the original owner, got %q", got.Addr)
	}
}
