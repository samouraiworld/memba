package blockparty_test

import (
	"testing"

	_ "modernc.org/sqlite"

	"github.com/samouraiworld/memba/backend/internal/blockparty"
	"github.com/samouraiworld/memba/backend/internal/db"
)

func TestMigration_BlockPartyTablesExist(t *testing.T) {
	database, err := db.Open(":memory:")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer func() { _ = database.Close() }()
	if err := db.Migrate(database); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	for _, tbl := range []string{"blockparty_challenges", "blockparty_scores", "blockparty_streaks"} {
		var name string
		err := database.QueryRow(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`, tbl).Scan(&name)
		if err != nil {
			t.Fatalf("table %s missing: %v", tbl, err)
		}
	}
}

func TestChallengeCache_Immutable(t *testing.T) {
	d, _ := db.Open(":memory:")
	defer func() { _ = d.Close() }()
	_ = db.Migrate(d)
	c := blockparty.Challenge{Date: "2026-07-06", Height: 10, Hash: "abc", Seed: 42, Modifier: "standard", Par: 1500}
	if err := blockparty.PutChallenge(d, c); err != nil {
		t.Fatal(err)
	}
	// second put with different values must NOT overwrite
	_ = blockparty.PutChallenge(d, blockparty.Challenge{Date: "2026-07-06", Height: 99, Hash: "zzz", Seed: 7, Modifier: "doubles", Par: 1})
	got, ok, err := blockparty.GetChallenge(d, "2026-07-06")
	if err != nil || !ok {
		t.Fatalf("get: ok=%v err=%v", ok, err)
	}
	if got.Height != 10 || got.Hash != "abc" || got.Seed != 42 {
		t.Fatalf("challenge mutated: %+v", got)
	}
}

func TestInsertScore_OnePerDay(t *testing.T) {
	d, _ := db.Open(":memory:")
	defer func() { _ = d.Close() }()
	_ = db.Migrate(d)
	ins1, _ := blockparty.InsertScore(d, "2026-07-06", "g1alice", 1200, "URDL", "bh1")
	ins2, _ := blockparty.InsertScore(d, "2026-07-06", "g1alice", 9999, "UUUU", "bh2")
	if !ins1 || ins2 {
		t.Fatalf("first insert=%v second insert=%v (want true,false)", ins1, ins2)
	}
	top, _ := blockparty.TopScores(d, "2026-07-06", 10)
	if len(top) != 1 || top[0].Score != 1200 {
		t.Fatalf("top=%+v want single 1200", top)
	}
}

func TestBumpStreak_ConsecutiveAndFreeze(t *testing.T) {
	d, _ := db.Open(":memory:")
	defer func() { _ = d.Close() }()
	_ = db.Migrate(d)
	s1, _ := blockparty.BumpStreak(d, "g1bob", "2026-07-06")
	if s1.Current != 1 {
		t.Fatalf("current=%d want 1", s1.Current)
	}
	s2, _ := blockparty.BumpStreak(d, "g1bob", "2026-07-07")
	if s2.Current != 2 {
		t.Fatalf("consecutive day current=%d want 2", s2.Current)
	}
	// skip 07-08, play 07-09: one freeze absorbs the single miss -> streak continues
	s3, _ := blockparty.BumpStreak(d, "g1bob", "2026-07-09")
	if s3.Current != 3 {
		t.Fatalf("after freeze current=%d want 3", s3.Current)
	}
}
