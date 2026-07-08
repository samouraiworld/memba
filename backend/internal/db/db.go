package db

import (
	"database/sql"
	"embed"
	"fmt"
	"log/slog"
	"strings"
)

//go:embed migrations/*.sql
var migrationsFS embed.FS

// maxOpenConns bounds the SQLite connection pool. WAL supports one writer
// concurrently with multiple readers, so several connections let reads run
// while a write is in flight instead of serializing behind it.
const maxOpenConns = 4

// Open creates a new SQLite connection with WAL mode and foreign keys enabled.
func Open(path string) (*sql.DB, error) {
	// busy_timeout(5000): a contended writer waits up to 5s for the lock instead
	// of failing immediately with SQLITE_BUSY (the WAL checkpoint and the NFT
	// indexer tailer can briefly hold it).
	db, err := sql.Open("sqlite", path+"?_pragma=journal_mode(WAL)&_pragma=foreign_keys(ON)&_pragma=busy_timeout(5000)")
	if err != nil {
		return nil, fmt.Errorf("open database: %w", err)
	}

	// Connection pool settings for SQLite (WAL).
	//
	// Previously capped at 1, which serialized EVERY read behind EVERY write
	// (and the in-process indexer tailers): an RPC read could not acquire a
	// connection while a write transaction held the only one, so reads queued
	// behind indexer writes — the dominant source of intermittent backend lag.
	// WAL runs one writer alongside multiple readers, and busy_timeout(5000)
	// makes the rare write-vs-write overlap wait for the lock; the pure-Go
	// modernc.org/sqlite driver fully supports a multi-connection WAL pool.
	//
	// A plain in-memory database (tests) is the exception: it is private to its
	// connection, so poolSize keeps it single-connection to preserve shared
	// state. Production is always file-backed and gets the full pool.
	n := poolSize(path)
	db.SetMaxOpenConns(n)
	db.SetMaxIdleConns(n)

	if err := db.Ping(); err != nil {
		return nil, fmt.Errorf("ping database: %w", err)
	}

	return db, nil
}

// poolSize returns the connection-pool bound for a database path. A plain
// in-memory SQLite database is private to its connection, so a pool larger than
// one would hand out connections backed by different (empty) databases — the
// pool is capped at 1 for it. Shared-cache in-memory and file-backed databases
// (production) can safely use the multi-connection WAL pool.
func poolSize(path string) int {
	inMemory := strings.Contains(path, ":memory:") || strings.Contains(path, "mode=memory")
	if inMemory && !strings.Contains(path, "cache=shared") {
		return 1
	}
	return maxOpenConns
}

// Migrate runs all SQL migration files in order.
func Migrate(db *sql.DB) error {
	// Create migrations tracking table
	if _, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS _migrations (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT NOT NULL UNIQUE,
			applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
		)
	`); err != nil {
		return fmt.Errorf("create migrations table: %w", err)
	}

	entries, err := migrationsFS.ReadDir("migrations")
	if err != nil {
		return fmt.Errorf("read migrations dir: %w", err)
	}

	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".sql") {
			continue
		}

		// Check if already applied
		var count int
		if err := db.QueryRow("SELECT COUNT(*) FROM _migrations WHERE name = ?", entry.Name()).Scan(&count); err != nil {
			return fmt.Errorf("check migration %s: %w", entry.Name(), err)
		}
		if count > 0 {
			continue
		}

		// Read and execute migration
		content, err := migrationsFS.ReadFile("migrations/" + entry.Name())
		if err != nil {
			return fmt.Errorf("read migration %s: %w", entry.Name(), err)
		}

		tx, err := db.Begin()
		if err != nil {
			return fmt.Errorf("begin migration %s: %w", entry.Name(), err)
		}

		if _, err := tx.Exec(string(content)); err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("execute migration %s: %w", entry.Name(), err)
		}

		if _, err := tx.Exec("INSERT INTO _migrations (name) VALUES (?)", entry.Name()); err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("record migration %s: %w", entry.Name(), err)
		}

		if err := tx.Commit(); err != nil {
			return fmt.Errorf("commit migration %s: %w", entry.Name(), err)
		}

		slog.Info("applied migration", "name", entry.Name())
	}

	return nil
}
