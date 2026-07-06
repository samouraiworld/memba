-- Deterministic per-post block time (unix seconds), denormalized from the block
-- header at ingest (feed tailer). The prior display path relied on block_h alone
-- ("block 12345"), which is not a human time; the ingest wall-clock created_at
-- is non-deterministic (it re-stamps on a rebuild-from-raw), so it is NOT the
-- source of truth for display. block_ts is deterministic and survives rebuild.
-- 0 = unknown (rows created before this migration; backfilled lazily/opportunistically).
ALTER TABLE feed_posts ADD COLUMN block_ts INTEGER NOT NULL DEFAULT 0;
