-- Social feed indexer (W7.2 P0). Projection of the memba_feed_v1 realm's
-- chain.Emit events. Fully decoupled from the NFT money-path indexer: its own
-- cursor (feed_indexer_state) and its own immutable ledger (feed_raw_events),
-- so a feed reorg or bug never touches marketplace state and vice versa.

-- Per-realm tail cursor (mirrors nft_indexer_state; separate table = separate
-- lifecycle from the NFT tailer).
CREATE TABLE IF NOT EXISTS feed_indexer_state (
    realm_path           TEXT PRIMARY KEY,
    last_processed_block INTEGER NOT NULL DEFAULT 0,
    block_hash           TEXT,
    updated_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Immutable raw ledger — source of truth; the projection is rebuildable from
-- it. Idempotent on the event position tuple.
CREATE TABLE IF NOT EXISTS feed_raw_events (
    event_block    INTEGER NOT NULL,
    event_tx_index INTEGER NOT NULL,
    event_index    INTEGER NOT NULL,
    pkg_path       TEXT NOT NULL,
    event_name     TEXT NOT NULL,
    attrs_json     TEXT NOT NULL,
    block_hash     TEXT,
    ingest_ts      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (event_block, event_tx_index, event_index)
);

-- Post projection. Keyed by the realm's monotonic post id (unique per realm),
-- so PostCreated is idempotent (INSERT OR IGNORE) and the mutating events
-- (edit/delete/flag/hide/mod) UPDATE the same row. created_event_block is kept
-- for reorg rollback (delete posts created in rolled-back blocks).
CREATE TABLE IF NOT EXISTS feed_posts (
    post_id             INTEGER PRIMARY KEY, -- realm post id
    author              TEXT NOT NULL,
    body                TEXT NOT NULL DEFAULT '',
    reply_to            INTEGER NOT NULL DEFAULT 0, -- 0 = top-level
    repost_of           INTEGER NOT NULL DEFAULT 0, -- 0 = original (P1)
    block_h             INTEGER NOT NULL DEFAULT 0, -- creation block height
    edited_at           INTEGER NOT NULL DEFAULT 0,
    flag_count          INTEGER NOT NULL DEFAULT 0,
    hidden              INTEGER NOT NULL DEFAULT 0, -- 0/1
    deleted             INTEGER NOT NULL DEFAULT 0, -- 0/1
    created_event_block INTEGER NOT NULL DEFAULT 0,
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Home timeline: newest visible top-level+reply posts, id-descending.
CREATE INDEX IF NOT EXISTS idx_feed_posts_visible
    ON feed_posts (hidden, deleted, post_id DESC);

-- User timeline: one author's newest posts.
CREATE INDEX IF NOT EXISTS idx_feed_posts_author
    ON feed_posts (author, post_id DESC);

-- Thread: a parent's replies in id order.
CREATE INDEX IF NOT EXISTS idx_feed_posts_parent
    ON feed_posts (reply_to, post_id);

-- Reorg rollback lookup.
CREATE INDEX IF NOT EXISTS idx_feed_posts_created_block
    ON feed_posts (created_event_block);
