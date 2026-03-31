package db

import (
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
	database, err := Open(":memory:")
	if err != nil {
		t.Fatal("failed to open database:", err)
	}
	t.Cleanup(func() { _ = database.Close() })

	stats := database.Stats()
	if stats.MaxOpenConnections != 1 {
		t.Fatalf("expected MaxOpenConnections=1 (SQLite single writer), got %d", stats.MaxOpenConnections)
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
