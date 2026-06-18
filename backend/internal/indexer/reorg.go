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
// ledger and the event-keyed projections — reorg recovery. After the deletes,
// nft_collections aggregate totals (total_volume_ugnot, total_sales,
// last_sale_price_ugnot) are recomputed from the surviving nft_sales rows so
// that replay's later incremental += composes correctly without inflation.
// Callers re-tail from `height` after rollback.
func rollbackFromHeight(ctx context.Context, db *sql.DB, height int64) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	// Capture collections that have sales at or above height BEFORE deleting,
	// so we know which aggregates to recompute after the deletes.
	rows, err := tx.QueryContext(ctx,
		`SELECT DISTINCT collection_id FROM nft_sales WHERE event_block >= ?`, height)
	if err != nil {
		return err
	}
	var affectedCollections []string
	for rows.Next() {
		var colID string
		if err := rows.Scan(&colID); err != nil {
			_ = rows.Close()
			return err
		}
		affectedCollections = append(affectedCollections, colID)
	}
	if err := rows.Close(); err != nil {
		return err
	}
	if err := rows.Err(); err != nil {
		return err
	}

	// Delete rolled-back rows across all event-keyed tables.
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

	// Recompute collection aggregates from surviving sales so that the
	// subsequent replay's incremental += starts from the correct baseline.
	for _, colID := range affectedCollections {
		_, err := tx.ExecContext(ctx, `
UPDATE nft_collections SET
  total_volume_ugnot    = (SELECT COALESCE(SUM(price_ugnot), 0) FROM nft_sales WHERE collection_id = ?),
  total_sales           = (SELECT COUNT(*)                      FROM nft_sales WHERE collection_id = ?),
  last_sale_price_ugnot = (SELECT price_ugnot FROM nft_sales WHERE collection_id = ?
                           ORDER BY sale_block DESC, event_block DESC,
                                    event_tx_index DESC, event_index DESC LIMIT 1),
  updated_at = CURRENT_TIMESTAMP
WHERE collection_id = ?`, colID, colID, colID, colID)
		if err != nil {
			return err
		}
	}

	return tx.Commit()
}
