package db

import (
	"path/filepath"
	"testing"

	_ "modernc.org/sqlite"
)

func TestOpen_InMemory(t *testing.T) {
	database, err := Open(":memory:")
	if err != nil {
		t.Fatal("failed to open in-memory database:", err)
	}
	t.Cleanup(func() { _ = database.Close() })

	// Verify WAL mode is enabled
	var journalMode string
	if err := database.QueryRow("PRAGMA journal_mode").Scan(&journalMode); err != nil {
		t.Fatal("failed to query journal_mode:", err)
	}
	// In-memory databases may report "memory" instead of "wal"
	if journalMode != "wal" && journalMode != "memory" {
		t.Fatalf("expected journal_mode 'wal' or 'memory', got %q", journalMode)
	}

	// Verify foreign keys are enabled
	var fkEnabled int
	if err := database.QueryRow("PRAGMA foreign_keys").Scan(&fkEnabled); err != nil {
		t.Fatal("failed to query foreign_keys:", err)
	}
	if fkEnabled != 1 {
		t.Fatalf("expected foreign_keys=1, got %d", fkEnabled)
	}
}

func TestOpen_MaxConnections(t *testing.T) {
	// File-backed (production) uses the multi-connection WAL pool so reads run
	// concurrently with the single writer instead of serializing behind it.
	fileDB, err := Open(filepath.Join(t.TempDir(), "conns.db"))
	if err != nil {
		t.Fatal("failed to open file database:", err)
	}
	t.Cleanup(func() { _ = fileDB.Close() })
	if got := fileDB.Stats().MaxOpenConnections; got != maxOpenConns {
		t.Fatalf("file-backed: expected MaxOpenConnections=%d, got %d", maxOpenConns, got)
	}

	// A plain in-memory database is private to its connection, so it stays
	// single-connection to keep shared state (tests rely on this).
	memDB, err := Open(":memory:")
	if err != nil {
		t.Fatal("failed to open in-memory database:", err)
	}
	t.Cleanup(func() { _ = memDB.Close() })
	if got := memDB.Stats().MaxOpenConnections; got != 1 {
		t.Fatalf("in-memory: expected MaxOpenConnections=1, got %d", got)
	}
}

func TestOpen_SetsBusyTimeout(t *testing.T) {
	database, err := Open(":memory:")
	if err != nil {
		t.Fatal("failed to open database:", err)
	}
	t.Cleanup(func() { _ = database.Close() })

	// A busy_timeout makes a contended writer WAIT (up to N ms) instead of
	// failing immediately with SQLITE_BUSY — important under the WAL checkpoint
	// and the concurrent NFT indexer tailer.
	var busyTimeout int
	if err := database.QueryRow("PRAGMA busy_timeout").Scan(&busyTimeout); err != nil {
		t.Fatal("failed to query busy_timeout:", err)
	}
	if busyTimeout != 5000 {
		t.Fatalf("expected busy_timeout=5000ms, got %d", busyTimeout)
	}
}

func TestMigrate_CreatesTablesAndTracks(t *testing.T) {
	database, err := Open(":memory:")
	if err != nil {
		t.Fatal("failed to open database:", err)
	}
	t.Cleanup(func() { _ = database.Close() })

	if err := Migrate(database); err != nil {
		t.Fatal("migration failed:", err)
	}

	// Check that _migrations table exists and has entries
	var count int
	if err := database.QueryRow("SELECT COUNT(*) FROM _migrations").Scan(&count); err != nil {
		t.Fatal("failed to query _migrations:", err)
	}
	if count < 2 {
		t.Fatalf("expected at least 2 migrations applied, got %d", count)
	}

	// Verify migration names were recorded
	rows, err := database.Query("SELECT name FROM _migrations ORDER BY id")
	if err != nil {
		t.Fatal("failed to query migration names:", err)
	}
	t.Cleanup(func() { _ = rows.Close() })

	var names []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			t.Fatal("failed to scan migration name:", err)
		}
		names = append(names, name)
	}

	if names[0] != "001_initial.sql" {
		t.Fatalf("expected first migration '001_initial.sql', got %q", names[0])
	}
	if names[1] != "002_profiles.sql" {
		t.Fatalf("expected second migration '002_profiles.sql', got %q", names[1])
	}
}

func TestMigrate_Idempotent(t *testing.T) {
	database, err := Open(":memory:")
	if err != nil {
		t.Fatal("failed to open database:", err)
	}
	t.Cleanup(func() { _ = database.Close() })

	// Run migrations twice — should not fail
	if err := Migrate(database); err != nil {
		t.Fatal("first migration failed:", err)
	}
	if err := Migrate(database); err != nil {
		t.Fatal("second migration failed (not idempotent):", err)
	}

	// Should still have same number of tracked migrations
	var count int
	if err := database.QueryRow("SELECT COUNT(*) FROM _migrations").Scan(&count); err != nil {
		t.Fatal("failed to count migrations:", err)
	}
	if count < 2 {
		t.Fatalf("expected at least 2 migrations, got %d", count)
	}
}

func TestMigrate_ProfilesTableExists(t *testing.T) {
	database, err := Open(":memory:")
	if err != nil {
		t.Fatal("failed to open database:", err)
	}
	t.Cleanup(func() { _ = database.Close() })

	if err := Migrate(database); err != nil {
		t.Fatal("migration failed:", err)
	}

	// Verify profiles table was created with expected columns
	_, err = database.Exec(`
		INSERT INTO profiles (address, bio, company, title, avatar_url, twitter, github, website, updated_at)
		VALUES ('g1test', 'bio', 'company', 'title', 'https://avatar.url', '@handle', 'gh_user', 'https://site.com', '2026-01-01T00:00:00Z')
	`)
	if err != nil {
		t.Fatal("failed to insert into profiles:", err)
	}

	// Verify unique constraint on address
	_, err = database.Exec(`
		INSERT INTO profiles (address, bio, company, title, avatar_url, twitter, github, website, updated_at)
		VALUES ('g1test', 'bio2', '', '', '', '', '', '', '2026-01-02T00:00:00Z')
	`)
	if err == nil {
		t.Fatal("expected unique constraint violation on duplicate address")
	}
}

func TestMigrate_ForeignKeysEnforced(t *testing.T) {
	database, err := Open(":memory:")
	if err != nil {
		t.Fatal("failed to open database:", err)
	}
	t.Cleanup(func() { _ = database.Close() })

	if err := Migrate(database); err != nil {
		t.Fatal("migration failed:", err)
	}

	// Verify foreign keys are enforced by checking PRAGMA
	var fkEnabled int
	if err := database.QueryRow("PRAGMA foreign_keys").Scan(&fkEnabled); err != nil {
		t.Fatal("failed to query foreign_keys:", err)
	}
	if fkEnabled != 1 {
		t.Fatalf("expected foreign_keys=1 after migration, got %d", fkEnabled)
	}
}

func TestMigrate_013_RawLedgerAndColumns(t *testing.T) {
	database, err := Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = database.Close() }()
	if err := Migrate(database); err != nil {
		t.Fatal("migrate:", err)
	}
	// Raw ledger table exists and accepts a row.
	if _, err := database.Exec(`INSERT INTO nft_raw_events
		(event_block, event_tx_index, event_index, pkg_path, event_name, schema_version, attrs_json, block_hash, ingest_ts)
		VALUES (1,0,0,'gno.land/r/x','Sale','1','{}','abc', CURRENT_TIMESTAMP)`); err != nil {
		t.Fatalf("nft_raw_events insert: %v", err)
	}
	// New disambiguation columns exist on sales + offers.
	for _, q := range []string{
		`SELECT pkg_path, schema_version FROM nft_sales LIMIT 0`,
		`SELECT pkg_path, schema_version FROM nft_offers LIMIT 0`,
		`SELECT block_hash FROM nft_indexer_state LIMIT 0`,
	} {
		if _, err := database.Exec(q); err != nil {
			t.Fatalf("column missing: %q: %v", q, err)
		}
	}
}

func TestMigrate_026_ServingOverrides(t *testing.T) {
	database, err := Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = database.Close() }()
	if err := Migrate(database); err != nil {
		t.Fatal("migrate:", err)
	}

	// The out-of-band serving-override table exists and accepts a row.
	if _, err := database.Exec(`INSERT INTO feed_serving_overrides
		(post_id, reason, added_by) VALUES (7, 'false-positive brigade', 'ops')`); err != nil {
		t.Fatalf("feed_serving_overrides insert: %v", err)
	}
	// post_id is the primary key — a second row for the same post is rejected
	// (the endpoint upserts; the schema must enforce one row per post).
	if _, err := database.Exec(`INSERT INTO feed_serving_overrides (post_id) VALUES (7)`); err == nil {
		t.Fatal("expected PRIMARY KEY violation on duplicate post_id")
	}

	// The covering index that keeps the widened home-timeline read off a
	// TEMP B-TREE sort is present.
	var idxName string
	if err := database.QueryRow(
		`SELECT name FROM sqlite_master WHERE type='index' AND name='idx_feed_posts_served'`,
	).Scan(&idxName); err != nil {
		t.Fatalf("idx_feed_posts_served missing: %v", err)
	}
}
