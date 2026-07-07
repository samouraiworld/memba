-- Reactions projection (feed Item 4). One row per (post_id, emoji, reactor):
-- ReactionAdded INSERT OR IGNOREs, ReactionRemoved DELETEs. Per-emoji COUNTS are
-- always derived (GROUP BY), never stored, so the projection can't drift from
-- the event stream. Rebuildable from feed_raw_events like the rest of the feed.
CREATE TABLE IF NOT EXISTS feed_reactions (
    post_id     INTEGER NOT NULL,
    emoji       TEXT NOT NULL,
    reactor     TEXT NOT NULL,
    event_block INTEGER NOT NULL DEFAULT 0, -- reorg rollback
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (post_id, emoji, reactor)
);

-- Count aggregation (GROUP BY post_id, emoji) and the "did the viewer react"
-- lookup both scan by post_id.
CREATE INDEX IF NOT EXISTS idx_feed_reactions_post
    ON feed_reactions (post_id, emoji);

-- Reorg rollback: delete reactions recorded in rolled-back blocks.
CREATE INDEX IF NOT EXISTS idx_feed_reactions_block
    ON feed_reactions (event_block);
