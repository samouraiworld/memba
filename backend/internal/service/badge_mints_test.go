package service

import (
	"context"
	"testing"
)

// TestBadgeMintsDrainerSchema verifies migration 014 added the drainer columns
// (retry_count, last_error, tx_hash) and that a mint_status query works — the
// drainer's hot path, now backed by idx_badge_mints_status.
func TestBadgeMintsDrainerSchema(t *testing.T) {
	h := setup(t)
	ctx := context.Background()

	// Queue a mint using the new columns.
	if _, err := h.db.ExecContext(ctx,
		`INSERT INTO badge_mints (address, quest_id, mint_status, retry_count, last_error, tx_hash)
		 VALUES (?, ?, 'pending', 0, NULL, NULL)`,
		"g1alice", "connect-wallet",
	); err != nil {
		t.Fatal("insert badge_mint with drainer columns:", err)
	}

	// Simulate a failed broadcast: bump retry, record the error + (eventual) hash.
	if _, err := h.db.ExecContext(ctx,
		`UPDATE badge_mints SET mint_status='failed', retry_count=retry_count+1, last_error=? WHERE address=? AND quest_id=?`,
		"broadcast timeout", "g1alice", "connect-wallet",
	); err != nil {
		t.Fatal("update drainer columns:", err)
	}

	var count, retry int
	var lastErr string
	if err := h.db.QueryRowContext(ctx,
		`SELECT COUNT(*), COALESCE(MAX(retry_count),0), COALESCE(MAX(last_error),'')
		 FROM badge_mints WHERE mint_status='failed'`,
	).Scan(&count, &retry, &lastErr); err != nil {
		t.Fatal("query by mint_status:", err)
	}
	if count != 1 || retry != 1 || lastErr != "broadcast timeout" {
		t.Fatalf("unexpected drainer row: count=%d retry=%d lastErr=%q", count, retry, lastErr)
	}
}
