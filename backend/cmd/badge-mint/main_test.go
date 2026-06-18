package main

import (
	"database/sql"
	"testing"

	_ "modernc.org/sqlite"
)

func TestRankTier(t *testing.T) {
	cases := []struct {
		in     string
		tier   int
		isRank bool
	}{
		{"rank:3", 3, true},
		{"rank:0", 0, true},
		{"connect-wallet", 0, false},
		{"rank:abc", 0, false},
		{"deploy-hello-pkg", 0, false},
	}
	for _, c := range cases {
		tier, ok := rankTier(c.in)
		if ok != c.isRank || tier != c.tier {
			t.Errorf("rankTier(%q) = (%d,%v), want (%d,%v)", c.in, tier, ok, c.tier, c.isRank)
		}
	}
}

func TestPendingMints(t *testing.T) {
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = db.Close() }()

	if _, err := db.Exec(`CREATE TABLE badge_mints (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		address TEXT, quest_id TEXT, mint_status TEXT DEFAULT 'pending'
	)`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO badge_mints (address, quest_id, mint_status) VALUES
		('g1alice','connect-wallet','pending'),
		('g1bob','rank:2','pending'),
		('g1carol','use-cmdk','minted')`); err != nil {
		t.Fatal(err)
	}

	mints, err := pendingMints(db)
	if err != nil {
		t.Fatal(err)
	}
	if len(mints) != 2 {
		t.Fatalf("expected 2 pending (minted row excluded), got %d", len(mints))
	}
	if mints[0].QuestID != "connect-wallet" || mints[1].QuestID != "rank:2" {
		t.Fatalf("unexpected pending content: %+v", mints)
	}
}
