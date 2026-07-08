package db

import (
	"context"
	"path/filepath"
	"testing"
	"time"
)

// A read must not block behind an open (uncommitted) write transaction.
//
// Under a single-connection pool (SetMaxOpenConns(1)) the read cannot acquire a
// connection while the write transaction holds the only one, so it blocks until
// the transaction resolves — the exact serialization that made the backend feel
// laggy (every RPC read queued behind every indexer write). This test pins the
// concurrent-read guarantee: with WAL + a multi-connection pool, a read served
// by a second connection sees the last committed snapshot immediately.
func TestOpen_ReadDoesNotBlockBehindOpenWriteTx(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "pool.db")
	database, err := Open(dbPath)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer func() { _ = database.Close() }()

	if _, err := database.Exec(`CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)`); err != nil {
		t.Fatalf("create: %v", err)
	}
	if _, err := database.Exec(`INSERT INTO t (v) VALUES ('seed')`); err != nil {
		t.Fatalf("seed: %v", err)
	}

	// Hold a write transaction open (never committed) for the rest of the test.
	tx, err := database.BeginTx(context.Background(), nil)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.Exec(`INSERT INTO t (v) VALUES ('pending')`); err != nil {
		t.Fatalf("tx insert: %v", err)
	}

	// A concurrent read on the same pool must succeed promptly on another
	// connection instead of waiting for the write transaction to resolve.
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	var v string
	if err := database.QueryRowContext(ctx, `SELECT v FROM t WHERE v = 'seed'`).Scan(&v); err != nil {
		t.Fatalf("concurrent read blocked behind open write tx: %v", err)
	}
	if v != "seed" {
		t.Fatalf("got %q, want %q", v, "seed")
	}
}
