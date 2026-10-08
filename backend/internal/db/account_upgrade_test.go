package db

import (
	"path/filepath"
	"strings"
	"testing"
)

// Exercise the production upgrade from main 2e95e5f9, which already records
// the EVM 038/039 migrations. Migration identity is the entire filename, so
// the older account branch's names must coexist without replaying EVM SQL.
func TestAccountUpgradePreservesEVMMigrationsAndSurvivesRestart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "upgrade.db")
	database, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = database.Close() })
	if _, err := database.Exec(`CREATE TABLE _migrations (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT NOT NULL UNIQUE,
		applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
	)`); err != nil {
		t.Fatal(err)
	}
	accountMigrations := map[string]bool{
		"038_accounts.sql": true, "039_consents.sql": true, "040_webhook_events.sql": true, "041_account_deletions.sql": true,
	}
	entries, err := migrationsFS.ReadDir("migrations")
	if err != nil {
		t.Fatal(err)
	}
	baseline := 0
	for _, entry := range entries {
		name := entry.Name()
		if !strings.HasSuffix(name, ".sql") || accountMigrations[name] || name > "039_evm_safes.sql" {
			continue
		}
		body, err := migrationsFS.ReadFile("migrations/" + name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := database.Exec(string(body)); err != nil {
			t.Fatalf("baseline %s: %v", name, err)
		}
		if _, err := database.Exec("INSERT INTO _migrations (name) VALUES (?)", name); err != nil {
			t.Fatal(err)
		}
		baseline++
	}
	if _, err := database.Exec(`
		INSERT INTO siwe_used_nonces (nonce, expires_at) VALUES ('already-used', 2000000000);
		INSERT INTO evm_safe_members (chain_id, safe_address, user_address, name)
		VALUES ('eip155:84532', 'safe-fixture', 'owner-fixture', 'Keep this name');
	`); err != nil {
		t.Fatal(err)
	}
	if err := Migrate(database); err != nil {
		t.Fatalf("upgrade: %v", err)
	}
	var applied int
	if err := database.QueryRow("SELECT COUNT(*) FROM _migrations").Scan(&applied); err != nil {
		t.Fatal(err)
	}
	if applied < baseline+len(accountMigrations) {
		t.Fatalf("expected all account migrations after %d baseline migrations, got %d", baseline, applied)
	}
	for name := range accountMigrations {
		var n int
		if err := database.QueryRow("SELECT COUNT(*) FROM _migrations WHERE name = ?", name).Scan(&n); err != nil || n != 1 {
			t.Fatalf("%s recorded %d times: %v", name, n, err)
		}
	}
	if _, err := database.Exec(`
		INSERT INTO accounts (id, idp, idp_subject, email, created_at, email_changed_at)
		VALUES ('account-fixture', 'clerk', 'subject-fixture', 'test@example.org', '2026-10-08T00:00:00Z', '2026-10-08T00:00:00Z');
		INSERT INTO consents (account_id, topic, email, wording_version, source, requested_at)
		VALUES ('account-fixture', 'newsletter', 'test@example.org', 'v1', 'test', '2026-10-08T00:00:00Z');
		INSERT INTO webhook_events (id, received_at) VALUES ('event-fixture', '2026-10-08T00:00:00Z');
	`); err != nil {
		t.Fatalf("account schema: %v", err)
	}
	if err := database.Close(); err != nil {
		t.Fatal(err)
	}
	database, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := Migrate(database); err != nil {
		t.Fatalf("restart must not replay ALTER TABLE: %v", err)
	}
	var after int
	if err := database.QueryRow("SELECT COUNT(*) FROM _migrations").Scan(&after); err != nil || after != applied {
		t.Fatalf("restart changed migration count: %d -> %d (%v)", applied, after, err)
	}
	var expires int64
	if err := database.QueryRow("SELECT expires_at FROM siwe_used_nonces WHERE nonce = 'already-used'").Scan(&expires); err != nil || expires != 2000000000 {
		t.Fatalf("used nonce lost: %d (%v)", expires, err)
	}
	var name string
	if err := database.QueryRow("SELECT name FROM evm_safe_members WHERE safe_address = 'safe-fixture'").Scan(&name); err != nil || name != "Keep this name" {
		t.Fatalf("Safe membership changed: %q (%v)", name, err)
	}
	if _, err := database.Exec("DELETE FROM accounts WHERE id = 'account-fixture'"); err != nil {
		t.Fatal(err)
	}
	var consents int
	if err := database.QueryRow("SELECT COUNT(*) FROM consents WHERE account_id = 'account-fixture'").Scan(&consents); err != nil || consents != 0 {
		t.Fatalf("account deletion must cascade after restart: %d (%v)", consents, err)
	}
}
