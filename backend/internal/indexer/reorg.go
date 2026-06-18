package indexer

import (
	"context"
	"database/sql"
)

// confirmedEnd returns the highest block height safe to process this cycle:
// bounded by the confirmed tip (latest - confirmations) and the per-cycle cap
// (cursor + maxPerCycle). Returns cursor (no work) when not past it.
func confirmedEnd(latest, confirmations, cursor, maxPerCycle int64) int64 {
	safeTip := latest - confirmations
	if safeTip < 0 {
		safeTip = 0
	}
	end := safeTip
	if end > cursor+maxPerCycle {
		end = cursor + maxPerCycle
	}
	if end < cursor {
		end = cursor
	}
	return end
}

// rollbackFromHeight deletes all indexed rows at or above height across the raw
// ledger and the event-keyed projections — reorg recovery. Aggregate tables
// (nft_collections totals) are rebuilt by replaying the kept raw ledger; callers
// re-tail from `height` after rollback.
func rollbackFromHeight(ctx context.Context, db *sql.DB, height int64) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	for _, stmt := range []string{
		`DELETE FROM nft_raw_events WHERE event_block >= ?`,
		`DELETE FROM nft_sales WHERE event_block >= ?`,
		`DELETE FROM nft_listings WHERE event_block >= ?`,
		`DELETE FROM nft_offers WHERE event_block >= ?`,
		`DELETE FROM nft_ownership_history WHERE block >= ?`,
	} {
		if _, err := tx.ExecContext(ctx, stmt, height); err != nil {
			return err
		}
	}
	return tx.Commit()
}
