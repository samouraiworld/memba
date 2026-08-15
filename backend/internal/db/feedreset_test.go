package db

import (
	"path/filepath"
	"testing"
)

// The reset must wipe ALL five feed tables in one shot — a cursor-only reset
// silently swallows new posts after a chain switch (realm-scoped post ids), so
// the test seeds BOTH state and content and asserts both go to zero.
func TestResetFeedState_WipesAllFiveTables(t *testing.T) {
	path := filepath.Join(t.TempDir(), "feedreset.db")
	database, err := Open(path)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	if err := Migrate(database); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	seed := []string{
		`INSERT INTO feed_indexer_state (realm_path, last_processed_block, block_hash, updated_at)
		 VALUES ('gno.land/r/samcrew/memba_feed_v1', 561640, 'deadbeef', '2026-08-10T14:28:26Z')`,
		`INSERT INTO feed_posts (post_id, author, body, block_h)
		 VALUES (1, 'g1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'old-chain post', 94100)`,
	}
	for _, q := range seed {
		if _, err := database.Exec(q); err != nil {
			t.Fatalf("seed (%s): %v", q[:40], err)
		}
	}
	if err := database.Close(); err != nil {
		t.Fatalf("close: %v", err)
	}

	counts, err := ResetFeedState(path)
	if err != nil {
		t.Fatalf("ResetFeedState: %v", err)
	}
	if counts["feed_indexer_state"] != 1 {
		t.Fatalf("feed_indexer_state deleted=%d, want 1", counts["feed_indexer_state"])
	}
	if counts["feed_posts"] != 1 {
		t.Fatalf("feed_posts deleted=%d, want 1", counts["feed_posts"])
	}
	for _, table := range feedResetTables {
		if _, ok := counts[table]; !ok {
			t.Fatalf("missing count for %s — a table left out of the reset is the corruption path", table)
		}
	}

	verify, err := Open(path)
	if err != nil {
		t.Fatalf("reopen: %v", err)
	}
	defer func() { _ = verify.Close() }()
	for _, table := range []string{"feed_indexer_state", "feed_posts"} {
		var n int
		if err := verify.QueryRow("SELECT COUNT(*) FROM " + table).Scan(&n); err != nil {
			t.Fatalf("count %s: %v", table, err)
		}
		if n != 0 {
			t.Fatalf("%s has %d rows after reset, want 0", table, n)
		}
	}
}

// A missing database file must be an error — SQLite would otherwise CREATE an
// empty db and report a successful "reset" of nothing (the integrity-check
// lesson, applied here).
func TestResetFeedState_RefusesMissingFile(t *testing.T) {
	if _, err := ResetFeedState(filepath.Join(t.TempDir(), "absent.db")); err == nil {
		t.Fatal("expected an error for a missing database file")
	}
}
