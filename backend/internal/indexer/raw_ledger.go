package indexer

import (
	"context"
	"database/sql"
	"encoding/json"
)

// recordRawEvent writes the immutable raw-ledger row for an event. It is the
// source of truth; projection tables are rebuildable from it. Idempotent on
// (event_block, event_tx_index, event_index). The full attr map is stored as
// JSON so no field is ever lost to a lossy projection column.
func recordRawEvent(ctx context.Context, db *sql.DB, ev GnoEvent, blockHash string) error {
	attrs, err := json.Marshal(ev.Attrs)
	if err != nil {
		return err
	}
	_, err = db.ExecContext(ctx, `
		INSERT OR IGNORE INTO nft_raw_events
			(event_block, event_tx_index, event_index, pkg_path, event_name,
			 schema_version, attrs_json, block_hash, ingest_ts)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
		ev.Block, ev.TxIndex, ev.EventIdx, ev.PkgPath, ev.Type,
		ev.Attr("schemaVersion"), string(attrs), blockHash,
	)
	return err
}
