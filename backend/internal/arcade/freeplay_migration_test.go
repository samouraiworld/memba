package arcade

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/samouraiworld/memba/backend/internal/db"
)

func TestFreePlayMigrationFreshDatabase(t *testing.T) {
	s := freeStore(t)
	for _, table := range []string{"arcade_freeplay_runs_v2", "arcade_freeplay_quotes_v2", "arcade_freeplay_outbox_v2", "arcade_freeplay_signers_v2"} {
		var count int
		if err := s.db.QueryRow(`SELECT count(*) FROM sqlite_master WHERE type='table' AND name=?`, table).Scan(&count); err != nil || count != 1 {
			t.Fatalf("%s: %d %v", table, count, err)
		}
	}
	if err := db.Migrate(s.db); err != nil {
		t.Fatal("repeat migration", err)
	}
}
func TestFreePlayMigrationExistingBackupRestore(t *testing.T) {
	directory := t.TempDir()
	database, err := db.Open(filepath.Join(directory, "existing.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	if _, err = database.Exec(`CREATE TABLE _migrations(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL UNIQUE,applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`); err != nil {
		t.Fatal(err)
	}
	files, err := filepath.Glob("../db/migrations/*.sql")
	if err != nil {
		t.Fatal(err)
	}
	// Reconstruct this branch's pre-042 database, without requiring a git process
	// or making assumptions about an unrelated account migration's number.
	for _, file := range files {
		if filepath.Base(file) == "042_arcade_freeplay_v2.sql" {
			continue
		}
		raw, err := os.ReadFile(file)
		if err != nil {
			t.Fatal(err)
		}
		tx, err := database.Begin()
		if err != nil {
			t.Fatal(err)
		}
		if _, err = tx.Exec(string(raw)); err != nil {
			_ = tx.Rollback()
			t.Fatal(err)
		}
		if _, err = tx.Exec(`INSERT INTO _migrations(name) VALUES(?)`, filepath.Base(file)); err != nil {
			_ = tx.Rollback()
			t.Fatal(err)
		}
		if err = tx.Commit(); err != nil {
			t.Fatal(err)
		}
	}
	if err = NewStore(database).InsertRun(Run{LogHash: "legacy-kept", Addr: "legacy-player", Game: "barricade", Day: "2026-10-08", Mode: "daily", Seed: "barricade-2026-10-08", SimVersion: 2, Score: 123, StateHash: "legacy", Events: "[]", CreatedAt: 1}); err != nil {
		t.Fatal(err)
	}
	backup := filepath.Join(directory, "pre-042.sqlite")
	if _, err = database.Exec(`VACUUM INTO ?`, backup); err != nil {
		t.Fatal("consistent backup", err)
	}
	if err = db.Migrate(database); err != nil {
		t.Fatal("existing migration", err)
	}
	if err = db.Migrate(database); err != nil {
		t.Fatal("repeat", err)
	}
	var score int
	if err = database.QueryRow(`SELECT score FROM arcade_runs WHERE input_log_sha256='legacy-kept'`).Scan(&score); err != nil || score != 123 {
		t.Fatal("legacy changed", score, err)
	}
	var count int
	if err = database.QueryRow(`SELECT COUNT(*) FROM arcade_freeplay_runs_v2`).Scan(&count); err != nil || count != 0 {
		t.Fatal("legacy imported into new queue", count, err)
	}
	// Reopening the consistent backup is a rollback proof, not a destructive
	// down migration. Existing code reads its old schema and data unchanged.
	restored, err := db.Open(backup)
	if err != nil {
		t.Fatal(err)
	}
	defer restored.Close()
	if err = restored.QueryRow(`SELECT score FROM arcade_runs WHERE input_log_sha256='legacy-kept'`).Scan(&score); err != nil || score != 123 {
		t.Fatal("restore data", score, err)
	}
	if err = restored.QueryRow(`SELECT COUNT(*) FROM _migrations WHERE name='042_arcade_freeplay_v2.sql'`).Scan(&count); err != nil || count != 0 {
		t.Fatal("backup includes future migration", count, err)
	}
}
