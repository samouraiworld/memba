-- feed_flags: durable projection of WHO flagged each post (feed v2 plan C.1).
-- The deployed memba_feed_v1 realm emits the flagger address in every
-- PostFlagged event ("flagger", caller — verified in the realm source), but the
-- dispatcher previously kept only the aggregate flag_count and discarded the
-- address. Projecting it here powers two W8.2 features without a realm change:
--   1. the moderation board's flagger set (who flagged, for a brigade review), and
--   2. durable "have I flagged this?" (viewer_has_flagged) — replacing the
--      per-mount localStorage hack that forgot across reloads.
--
-- Rebuildable from feed_raw_events (the flagger sits in attrs_json), so this is
-- a pure projection: forward-filled by the dispatcher and backfilled from raw
-- for flags that predate this migration. One row per (post, flagger) mirrors the
-- realm's flag tree (a flagger can flag a post at most once), so re-projecting
-- the tail is idempotent. event_block carries the flag's block so a reorg can
-- drop these rows the same way it drops posts/raw events at/above the height.
CREATE TABLE IF NOT EXISTS feed_flags (
    post_id      INTEGER NOT NULL, -- realm post id that was flagged
    flagger_addr TEXT    NOT NULL, -- bech32 address that flagged it
    event_block  INTEGER NOT NULL, -- block height of the PostFlagged event
    PRIMARY KEY (post_id, flagger_addr)
);

-- Serves the reorg rollback (DELETE ... WHERE event_block >= ?).
CREATE INDEX IF NOT EXISTS idx_feed_flags_block ON feed_flags(event_block);
