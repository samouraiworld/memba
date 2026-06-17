-- 013_nft_data_foundation.sql — raw event ledger + engine disambiguation + reorg state.
--
-- The raw ledger is the immutable source of truth (full attr blob, never lossy);
-- nft_sales/nft_offers/etc. are rebuildable projections. pkg_path + schema_version
-- let v3 (per-token) and future engines (e.g. memba_nft_offers_v1, floor offers)
-- coexist in one projection table without double-count. block_hash on the cursor
-- enables reorg detection.

CREATE TABLE IF NOT EXISTS nft_raw_events (
    event_block     INTEGER NOT NULL,
    event_tx_index  INTEGER NOT NULL,
    event_index     INTEGER NOT NULL,
    pkg_path        TEXT NOT NULL,
    event_name      TEXT NOT NULL,
    schema_version  TEXT,
    attrs_json      TEXT NOT NULL,
    block_hash      TEXT,
    ingest_ts       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (event_block, event_tx_index, event_index)
);

CREATE INDEX IF NOT EXISTS idx_nft_raw_events_pkg_name ON nft_raw_events (pkg_path, event_name);
CREATE INDEX IF NOT EXISTS idx_nft_raw_events_block ON nft_raw_events (event_block);

ALTER TABLE nft_sales  ADD COLUMN pkg_path TEXT;
ALTER TABLE nft_sales  ADD COLUMN schema_version TEXT;
ALTER TABLE nft_offers ADD COLUMN pkg_path TEXT;
ALTER TABLE nft_offers ADD COLUMN schema_version TEXT;
ALTER TABLE nft_indexer_state ADD COLUMN block_hash TEXT;
