-- 012_nft_events.sql — event-sourced NFT indexer tables
--
-- Upgrades the NFT indexer from Render-scraping to event-tailing: the block
-- tailer (internal/indexer/tailer.go) reads gno.land /block_results, parses the
-- chain.Emit GnoEvents from the memba_nft_v2 / memba_nft_market_v2 realms, and
-- writes normalized rows here. Event rows are idempotent via a UNIQUE constraint
-- on (event_block, event_tx_index, event_index) so re-processing a block never
-- duplicates. WAL journal mode is already set in db.Open.

-- Per-realm tailer cursor: the last fully-processed block height.
CREATE TABLE IF NOT EXISTS nft_indexer_state (
    realm_path           TEXT PRIMARY KEY,
    last_processed_block INTEGER NOT NULL DEFAULT 0,
    updated_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Listing lifecycle (one row per NFTListed event; closed by delisted_at_block).
CREATE TABLE IF NOT EXISTS nft_listings (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    collection_id     TEXT NOT NULL,
    token_id          TEXT NOT NULL,
    seller            TEXT,
    price_ugnot       INTEGER,
    listed_at_block   INTEGER,
    delisted_at_block INTEGER,
    delisted_reason   TEXT,
    event_block       INTEGER NOT NULL,
    event_tx_index    INTEGER NOT NULL,
    event_index       INTEGER NOT NULL,
    UNIQUE (event_block, event_tx_index, event_index)
);

CREATE INDEX IF NOT EXISTS idx_nft_listings_open
    ON nft_listings (collection_id, token_id, delisted_at_block);

-- Confirmed sales (purchases + accepted offers), full fee/royalty breakdown.
CREATE TABLE IF NOT EXISTS nft_sales (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    collection_id   TEXT NOT NULL,
    token_id        TEXT,
    seller          TEXT,
    buyer           TEXT,
    price_ugnot     INTEGER,
    fee_ugnot       INTEGER,
    royalty_ugnot   INTEGER,
    sale_block      INTEGER,
    sale_time       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    kind            TEXT,
    event_block     INTEGER NOT NULL,
    event_tx_index  INTEGER NOT NULL,
    event_index     INTEGER NOT NULL,
    UNIQUE (event_block, event_tx_index, event_index)
);

CREATE INDEX IF NOT EXISTS idx_nft_sales_collection_time ON nft_sales (collection_id, sale_block DESC);
CREATE INDEX IF NOT EXISTS idx_nft_sales_token ON nft_sales (collection_id, token_id);
CREATE INDEX IF NOT EXISTS idx_nft_sales_buyer ON nft_sales (buyer);
CREATE INDEX IF NOT EXISTS idx_nft_sales_seller ON nft_sales (seller);

-- Offers (made / cancelled / expired / accepted). One row per (token, buyer,
-- created_block); status tracks the lifecycle.
CREATE TABLE IF NOT EXISTS nft_offers (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    collection_id   TEXT NOT NULL,
    token_id        TEXT NOT NULL,
    buyer           TEXT NOT NULL,
    amount_ugnot    INTEGER,
    created_block   INTEGER NOT NULL,
    status          TEXT NOT NULL DEFAULT 'active',
    resolved_block  INTEGER,
    event_block     INTEGER NOT NULL,
    event_tx_index  INTEGER NOT NULL,
    event_index     INTEGER NOT NULL,
    UNIQUE (collection_id, token_id, buyer, created_block)
);

CREATE INDEX IF NOT EXISTS idx_nft_offers_token ON nft_offers (collection_id, token_id, status);

-- Ownership transfers (mints, market transfers, sale settlements).
CREATE TABLE IF NOT EXISTS nft_ownership_history (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    collection_id   TEXT NOT NULL,
    token_id        TEXT NOT NULL,
    from_addr       TEXT,
    to_addr         TEXT,
    block           INTEGER,
    at              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    kind            TEXT
);

CREATE INDEX IF NOT EXISTS idx_nft_ownership_token ON nft_ownership_history (collection_id, token_id);

-- Extend nft_tokens with denormalized listing state (driven by events now).
-- owner/listed/price_ugnot already exist (migration 011); add the seller and a
-- denormalized listing_price mirror so floor recompute reads from one table.
ALTER TABLE nft_tokens ADD COLUMN listing_seller TEXT;
ALTER TABLE nft_tokens ADD COLUMN minted_block INTEGER;

-- Extend nft_collections with the last sale price (floor_price_ugnot already
-- exists from migration 011).
ALTER TABLE nft_collections ADD COLUMN last_sale_price_ugnot INTEGER;
