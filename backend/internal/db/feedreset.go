package db

import (
	"database/sql"
	"fmt"
	"os"
)

// feedResetTables are the five chain-scoped feed tables, cursor first. They are
// wiped TOGETHER or not at all: `feed_posts.post_id` is the REALM's monotonic
// id, so after a chain switch a fresh realm restarts at 1 and the dispatcher's
// `INSERT OR IGNORE` silently swallows every new post whose id the OLD chain
// already used — a partial reset (cursor only) therefore corrupts, it doesn't
// degrade. `feed_raw_events` keys on (event_block, tx, idx), which collides
// across chains the same way.
var feedResetTables = []string{
	"feed_indexer_state",
	"feed_raw_events",
	"feed_posts",
	"feed_flags",
	"feed_reactions",
}

// ResetFeedState deletes all rows from the five feed tables in ONE transaction
// and returns the per-table deleted counts. It exists for chain cutovers: the
// feed tailer's cursor lives in the DB and always beats the FEED_START_BLOCK
// env floor, so pointing the backend at a new chain WITHOUT this reset leaves
// the tailer pinned to a height from the old one (see docs/OPS_RUNBOOK.md,
// chain-cutover invariants). Invoked via `memba feed-reset` because the runtime
// image ships no sqlite3 CLI — the driver embedded here is the only SQL path.
//
// The old chain's feed history is preserved by the Litestream replica
// (point-in-time restore), not by this function. A table that does not exist
// yet is skipped rather than failing, so the command is safe on a pre-feed
// database; the file itself must exist — SQLite would otherwise CREATE an
// empty database and "reset" it successfully.
func ResetFeedState(path string) (map[string]int64, error) {
	if _, err := os.Stat(path); err != nil {
		return nil, fmt.Errorf("feed reset: %w", err)
	}

	database, err := Open(path)
	if err != nil {
		return nil, fmt.Errorf("feed reset open: %w", err)
	}
	defer func() { _ = database.Close() }()

	tx, err := database.Begin()
	if err != nil {
		return nil, fmt.Errorf("feed reset begin: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	counts := make(map[string]int64, len(feedResetTables))
	for _, table := range feedResetTables {
		var name string
		err := tx.QueryRow(
			`SELECT name FROM sqlite_master WHERE type='table' AND name = ?`, table,
		).Scan(&name)
		if err == sql.ErrNoRows {
			counts[table] = -1 // absent (pre-feed schema) — recorded, not fatal
			continue
		}
		if err != nil {
			return nil, fmt.Errorf("feed reset lookup %s: %w", table, err)
		}
		// Table names come from the fixed list above, never from input.
		res, err := tx.Exec("DELETE FROM " + table)
		if err != nil {
			return nil, fmt.Errorf("feed reset delete %s: %w", table, err)
		}
		n, err := res.RowsAffected()
		if err != nil {
			return nil, fmt.Errorf("feed reset count %s: %w", table, err)
		}
		counts[table] = n
	}

	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("feed reset commit: %w", err)
	}
	return counts, nil
}
