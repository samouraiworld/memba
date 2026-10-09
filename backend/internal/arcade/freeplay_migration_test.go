package arcade

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"testing"

	"github.com/samouraiworld/memba/backend/internal/db"
)

const (
	freePlayMigration042 = "042_arcade_freeplay_v2.sql"
	freePlayMigration043 = "043_arcade_freeplay_spending_v2.sql"
)

// Check both the ledger and actual schema, including absence before migration.
func assertFreePlayMigrationState(t *testing.T, database *sql.DB, has042, has043 bool) {
	t.Helper()
	for _, group := range []struct {
		migration string
		present   bool
		tables    []string
		index     string
	}{
		{freePlayMigration042, has042, []string{"arcade_freeplay_runs_v2", "arcade_freeplay_quotes_v2", "arcade_freeplay_outbox_v2", "arcade_freeplay_signers_v2"}, "arcade_freeplay_scope_v2"},
		{freePlayMigration043, has043, []string{"arcade_freeplay_budget_v2", "arcade_freeplay_spending_v2"}, "arcade_freeplay_spending_scope_v2"},
	} {
		want := 0
		if group.present {
			want = 1
		}
		var count int
		if err := database.QueryRow(`SELECT count(*) FROM _migrations WHERE name=?`, group.migration).Scan(&count); err != nil || count != want {
			t.Fatalf("migration %s: count=%d want=%d err=%v", group.migration, count, want, err)
		}
		for _, table := range group.tables {
			if err := database.QueryRow(`SELECT count(*) FROM sqlite_master WHERE type='table' AND name=?`, table).Scan(&count); err != nil || count != want {
				t.Fatalf("table %s: count=%d want=%d err=%v", table, count, want, err)
			}
		}
		if err := database.QueryRow(`SELECT count(*) FROM sqlite_master WHERE type='index' AND name=?`, group.index).Scan(&count); err != nil || count != want {
			t.Fatalf("index %s: count=%d want=%d err=%v", group.index, count, want, err)
		}
	}
}

func TestFreePlayMigrationFreshDatabase(t *testing.T) {
	s := freeStore(t)
	assertFreePlayMigrationState(t, s.db, true, true)
	if err := db.Migrate(s.db); err != nil {
		t.Fatal("repeat migration", err)
	}
	assertFreePlayMigrationState(t, s.db, true, true)
}

// Replay only the chronological prefix before cutoff. Skipping a single file
// could accidentally include a later migration that depends on the missing one.
func applyFreePlayMigrationPrefix(t *testing.T, database *sql.DB, cutoff string) {
	t.Helper()
	if _, err := database.Exec(`CREATE TABLE _migrations(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL UNIQUE,applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`); err != nil {
		t.Fatal(err)
	}
	files, err := filepath.Glob("../db/migrations/*.sql") // Sorted by full filename, like db.Migrate.
	if err != nil {
		t.Fatal(err)
	}
	foundCutoff := false
	for _, file := range files {
		name := filepath.Base(file)
		if name == cutoff {
			foundCutoff = true
		}
		if name >= cutoff {
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
		if _, err = tx.Exec(`INSERT INTO _migrations(name) VALUES(?)`, name); err != nil {
			_ = tx.Rollback()
			t.Fatal(err)
		}
		if err = tx.Commit(); err != nil {
			_ = tx.Rollback()
			t.Fatal(err)
		}
	}
	if !foundCutoff {
		t.Fatalf("missing cutoff migration %s", cutoff)
	}
}

func TestFreePlayMigrationExistingBackupRestore(t *testing.T) {
	for _, test := range []struct {
		name   string
		cutoff string
		has042 bool
	}{
		{"before_042_and_043", freePlayMigration042, false},
		{"after_042_before_043", freePlayMigration043, true},
	} {
		t.Run(test.name, func(t *testing.T) {
			directory := t.TempDir()
			database, err := db.Open(filepath.Join(directory, "existing.sqlite"))
			if err != nil {
				t.Fatal(err)
			}
			defer func() {
				if err := database.Close(); err != nil {
					t.Error("close existing database", err)
				}
			}()
			applyFreePlayMigrationPrefix(t, database, test.cutoff)
			assertFreePlayMigrationState(t, database, test.has042, false)

			legacy := Run{LogHash: "legacy-kept", Addr: "legacy-player", Game: "barricade", Day: "2026-10-08", Mode: "daily", Seed: "barricade-2026-10-08", SimVersion: 2, Score: 123, StateHash: "legacy", Events: "[]", Status: "verified", CreatedAt: 1}
			if err = NewStore(database).InsertRun(legacy); err != nil {
				t.Fatal(err)
			}
			assertLegacy := func(database *sql.DB) {
				t.Helper()
				got, found, err := NewStore(database).GetRunByLogHash(legacy.LogHash)
				if err != nil || !found || got != legacy {
					t.Fatalf("legacy changed: found=%t got=%+v err=%v", found, got, err)
				}
			}
			var existing FreePlayRun
			if test.has042 {
				run := freeFixture(t)
				store, err := NewFreePlayStore(database, run.Target)
				if err != nil {
					t.Fatal(err)
				}
				existing, err = store.PutVerified(context.Background(), run, 10)
				if err != nil {
					t.Fatal(err)
				}
			}
			assertRuns := func(database *sql.DB) {
				t.Helper()
				want := 0
				if test.has042 {
					want = 1
					store, err := NewFreePlayStore(database, existing.Target)
					if err != nil {
						t.Fatal(err)
					}
					got, err := store.Get(context.Background(), existing.Entry.RunID)
					if err != nil || got != existing {
						t.Fatalf("pre-043 run changed: %+v %v", got, err)
					}
				}
				var count int
				if err := database.QueryRow(`SELECT count(*) FROM arcade_freeplay_runs_v2`).Scan(&count); err != nil || count != want {
					t.Fatalf("run count=%d want=%d err=%v; legacy must not enter v2", count, want, err)
				}
			}
			backup := filepath.Join(directory, test.name+".sqlite")
			if _, err = database.Exec(`VACUUM INTO ?`, backup); err != nil {
				t.Fatal("consistent backup", err)
			}
			for pass := 0; pass < 2; pass++ {
				if err = db.Migrate(database); err != nil {
					t.Fatalf("migration pass %d: %v", pass+1, err)
				}
				assertFreePlayMigrationState(t, database, true, true)
				assertLegacy(database)
				assertRuns(database)
				var count int
				if err = database.QueryRow(`SELECT (SELECT count(*) FROM arcade_freeplay_budget_v2) + (SELECT count(*) FROM arcade_freeplay_spending_v2)`).Scan(&count); err != nil || count != 0 {
					t.Fatal("migration fabricated spending", count, err)
				}
			}
			// Local consistent-snapshot recovery only: do not migrate the backup.
			// This is not a production/Litestream restore or an old-binary rehearsal.
			restored, err := db.Open(backup)
			if err != nil {
				t.Fatal(err)
			}
			defer func() {
				if err := restored.Close(); err != nil {
					t.Error("close restored database", err)
				}
			}()
			assertFreePlayMigrationState(t, restored, test.has042, false)
			assertLegacy(restored)
			if test.has042 {
				assertRuns(restored)
			}
			// Verify the legacy writer still works on the restored schema.
			legacy.LogHash = "legacy-after-restore"
			if err = NewStore(restored).InsertRun(legacy); err != nil {
				t.Fatal("legacy write after restore", err)
			}
			assertLegacy(restored)
		})
	}
}
