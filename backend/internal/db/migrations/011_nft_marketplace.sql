-- 011_nft_marketplace.sql — NFT marketplace state-polling indexer cache
-- Caches floor/tokens/activity from the live test13 NFT realms (memba_nft_v2,
-- memba_nft_market_v2), populated by the lightweight indexer poller. Read-only
-- from the RPC handlers' perspective; the poller is the only writer.

-- Per-collection cached state (one row per indexed collection).
CREATE TABLE IF NOT EXISTS nft_collections (
    collection_id       TEXT PRIMARY KEY,
    realm               TEXT,
    name                TEXT,
    symbol              TEXT,
    supply              INTEGER,
    royalty_bps         INTEGER,
    total_volume_ugnot  INTEGER,
    total_sales         INTEGER,
    active_listings     INTEGER,
    floor_price_ugnot   INTEGER,
    updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Per-token cached state (owner, URI, listing).
CREATE TABLE IF NOT EXISTS nft_tokens (
    collection_id   TEXT NOT NULL,
    token_id        TEXT NOT NULL,
    owner           TEXT,
    uri             TEXT,
    listed          INTEGER NOT NULL DEFAULT 0,
    price_ugnot     INTEGER,
    updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (collection_id, token_id)
);

CREATE INDEX IF NOT EXISTS idx_nft_tokens_owner ON nft_tokens (owner);
CREATE INDEX IF NOT EXISTS idx_nft_tokens_collection_listed ON nft_tokens (collection_id, listed);

-- Recent on-chain activity (sales), deduped by (collection_id, sale_no).
CREATE TABLE IF NOT EXISTS nft_activity (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    collection_id   TEXT NOT NULL,
    sale_no         INTEGER,
    token_id        TEXT,
    kind            TEXT,
    price_ugnot     INTEGER,
    seller          TEXT,
    buyer           TEXT,
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (collection_id, sale_no)
);

CREATE INDEX IF NOT EXISTS idx_nft_activity_collection ON nft_activity (collection_id);
