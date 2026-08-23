package db

import (
	"database/sql"
	"fmt"
	"os"
)

// nftResetTables are the nine chain-scoped NFT tables, cursor first. Like the
// feed set they are wiped TOGETHER or not at all: `nft_raw_events` and the
// listing/sale projections key on (event_block, event_tx_index, event_index),
// which collides across chains, and `loadCursor` takes the MIN
// last_processed_block across watched realms — so retained rows from a dead
// chain (heights far above a young chain's head) pin the tailer into
// "silently indexes nothing", and `SeedRealmCursor`'s INSERT OR IGNORE can
// never rewind them (see cmd/memba/main.go, NFT_INDEXER_DISABLED block).
// nft_collections/nft_tokens/nft_activity are pure projections of the event
// tables and would serve dead-chain volume/floor forever if kept.
var nftResetTables = []string{
	"nft_indexer_state",
	"nft_raw_events",
	"nft_listings",
	"nft_sales",
	"nft_offers",
	"nft_ownership_history",
	"nft_collections",
	"nft_tokens",
	"nft_activity",
}

// ResetNFTState deletes all rows from the nine NFT tables in ONE transaction
// and returns the per-table deleted counts. It exists for chain cutovers, as
// the required step before re-enabling the NFT tailer on a new chain (unset
// NFT_INDEXER_DISABLED): the cursor lives in the DB and always beats the
// NFT_START_BLOCK env floor. Invoked via `memba nft-reset` because the runtime
// image ships no sqlite3 CLI — the driver embedded here is the only SQL path.
//
// The old chain's NFT history is preserved by the Litestream replica
// (point-in-time restore), not by this function. A table that does not exist
// yet is skipped rather than failing, so the command is safe on a pre-NFT
// database; the file itself must exist — SQLite would otherwise CREATE an
// empty database and "reset" it successfully.
func ResetNFTState(path string) (map[string]int64, error) {
	if _, err := os.Stat(path); err != nil {
		return nil, fmt.Errorf("nft reset: %w", err)
	}

	database, err := Open(path)
	if err != nil {
		return nil, fmt.Errorf("nft reset open: %w", err)
	}
	defer func() { _ = database.Close() }()

	tx, err := database.Begin()
	if err != nil {
		return nil, fmt.Errorf("nft reset begin: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	counts := make(map[string]int64, len(nftResetTables))
	for _, table := range nftResetTables {
		var name string
		err := tx.QueryRow(
			`SELECT name FROM sqlite_master WHERE type='table' AND name = ?`, table,
		).Scan(&name)
		if err == sql.ErrNoRows {
			counts[table] = -1 // absent (pre-NFT schema) — recorded, not fatal
			continue
		}
		if err != nil {
			return nil, fmt.Errorf("nft reset lookup %s: %w", table, err)
		}
		// Table names come from the fixed list above, never from input.
		res, err := tx.Exec("DELETE FROM " + table)
		if err != nil {
			return nil, fmt.Errorf("nft reset delete %s: %w", table, err)
		}
		n, err := res.RowsAffected()
		if err != nil {
			return nil, fmt.Errorf("nft reset count %s: %w", table, err)
		}
		counts[table] = n
	}

	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("nft reset commit: %w", err)
	}
	return counts, nil
}
