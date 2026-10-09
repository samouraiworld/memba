-- Independent, chain-scoped cursor and bounded pending outbox. No existing
-- indexer/solvency state is reset or reused. Cursor + messages commit together.
CREATE TABLE IF NOT EXISTS activity_watch_state (
    chain_id TEXT PRIMARY KEY,
    height INTEGER NOT NULL,
    block_hash TEXT NOT NULL,
    heartbeat_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS activity_watch_outbox (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chain_id TEXT NOT NULL,
    height INTEGER NOT NULL,
    block_hash TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS activity_watch_outbox_chain ON activity_watch_outbox(chain_id, id);
