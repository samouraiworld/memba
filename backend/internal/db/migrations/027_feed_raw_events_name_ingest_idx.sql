-- Serves the Wave C.7 feed-abuse metrics (memba_feed_flags_per_hour /
-- unique_flaggers_per_day / auto_hides_per_day), which filter feed_raw_events by
-- (event_name, ingest_ts). Those COUNTs run per Prometheus scrape via GaugeFunc,
-- so this index keeps them an index range scan instead of a full-table scan.
-- Additive, idempotent; the raw ledger is otherwise untouched.
CREATE INDEX IF NOT EXISTS idx_feed_raw_events_name_ingest
    ON feed_raw_events (event_name, ingest_ts);

-- Same rationale for memba_feed_posting_authors_per_hour, which filters
-- feed_posts by (deleted, block_ts): no existing index leads with block_ts, so
-- without this the per-scrape COUNT full-scans feed_posts. deleted is the
-- equality prefix, block_ts the range.
CREATE INDEX IF NOT EXISTS idx_feed_posts_deleted_block_ts
    ON feed_posts (deleted, block_ts);
