-- Serving-blocklist (feed W8.2 growth-safety gate). An operator takedown lever:
-- a post's body lives permanently in the PostCreated event + feed_raw_events (an
-- immutable ledger), and DeletePost only tombstones the projection — so for
-- illegal / must-not-serve content the backend needs an AUTHORITATIVE, ops-only
-- suppression that every read path honors and that on-chain events can NEVER
-- reverse (unlike `hidden`, which UnhidePost/ModAction clear).
--
-- Deliberately SEPARATE from feed_posts.hidden: this row survives a
-- rebuild-from-raw (the projection is rebuildable; the blocklist is not derived
-- from events, it's an out-of-band operator decision) and is never touched by
-- the indexer. Reads exclude any post_id present here.
CREATE TABLE IF NOT EXISTS feed_blocklist (
    post_id    INTEGER PRIMARY KEY, -- realm post id (top-level or reply)
    reason     TEXT NOT NULL DEFAULT '',
    added_by   TEXT NOT NULL DEFAULT '', -- operator identity for audit
    added_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
