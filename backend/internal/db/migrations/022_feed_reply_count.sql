-- W1.4 — denormalize reply_count on feed_posts.
--
-- Replaces the per-row correlated subquery in feedPostSelect (feed_rpc.go) and
-- the un-indexable `ORDER BY reply_count` filesort in GetFeedStats with a stored
-- column, maintained by triggers.
--
-- A reply is LIVE (counts toward its parent) iff:
--   reply_to != 0 AND deleted = 0 AND hidden = 0 AND post_id NOT IN feed_blocklist
-- exactly the timeline's live-reply definition. The triggers compute the delta
-- from OLD/NEW liveness, so they are:
--   - idempotent against the indexer's re-processed PostCreated (INSERT OR IGNORE
--     that hits a conflict inserts nothing → no trigger fires) and its unguarded
--     hide UPDATE (same value re-applied → OLD==NEW → delta 0);
--   - correct across delete / hide / unhide / blocklist / un-blocklist / reorg.
-- Replies always carry a higher post_id than their parent (created later on
-- chain, processed in block order), so the parent row always exists when a
-- reply's INSERT trigger runs — including a full rebuild-from-raw replay.
--
-- Runner note: db.Migrate executes the whole file in one tx.Exec (modernc
-- sqlite runs multi-statement scripts, CREATE TRIGGER BEGIN..END included), and
-- keys _migrations on the filename, so this runs exactly once.

ALTER TABLE feed_posts ADD COLUMN reply_count INTEGER NOT NULL DEFAULT 0;

-- One-time backfill from the current live-reply definition.
UPDATE feed_posts SET reply_count = (
    SELECT COUNT(*) FROM feed_posts c
    WHERE c.reply_to = feed_posts.post_id
      AND c.deleted = 0 AND c.hidden = 0
      AND NOT EXISTS (SELECT 1 FROM feed_blocklist fb WHERE fb.post_id = c.post_id)
)
WHERE reply_to = 0;

-- Trending sort (GetFeedStats): seek the visible top-level set, read pre-sorted
-- by reply_count — removes the filesort.
CREATE INDEX IF NOT EXISTS idx_feed_posts_most_replied
    ON feed_posts (reply_to, hidden, deleted, reply_count DESC, post_id DESC);

-- (1) New reply → increment parent if the reply is live at insert time.
CREATE TRIGGER IF NOT EXISTS trg_feed_reply_count_insert
AFTER INSERT ON feed_posts
WHEN NEW.reply_to != 0
     AND NEW.deleted = 0 AND NEW.hidden = 0
     AND NOT EXISTS (SELECT 1 FROM feed_blocklist fb WHERE fb.post_id = NEW.post_id)
BEGIN
    UPDATE feed_posts SET reply_count = reply_count + 1 WHERE post_id = NEW.reply_to;
END;

-- (2) hidden/deleted flip on a reply → apply (newLive - oldLive) to parent.
-- Scoped to UPDATE OF hidden, deleted so the reply_count write below can never
-- re-fire this trigger. Blocklist state is unchanged here, so it cancels out.
CREATE TRIGGER IF NOT EXISTS trg_feed_reply_count_update
AFTER UPDATE OF hidden, deleted ON feed_posts
WHEN NEW.reply_to != 0
BEGIN
    UPDATE feed_posts SET reply_count = reply_count
        + (CASE WHEN NEW.deleted = 0 AND NEW.hidden = 0
                 AND NOT EXISTS (SELECT 1 FROM feed_blocklist fb WHERE fb.post_id = NEW.post_id)
                THEN 1 ELSE 0 END)
        - (CASE WHEN OLD.deleted = 0 AND OLD.hidden = 0
                 AND NOT EXISTS (SELECT 1 FROM feed_blocklist fb WHERE fb.post_id = OLD.post_id)
                THEN 1 ELSE 0 END)
      WHERE post_id = NEW.reply_to;
END;

-- (3) Reply row deleted (reorg rollback) → decrement parent if it was live.
CREATE TRIGGER IF NOT EXISTS trg_feed_reply_count_delete
AFTER DELETE ON feed_posts
WHEN OLD.reply_to != 0
     AND OLD.deleted = 0 AND OLD.hidden = 0
     AND NOT EXISTS (SELECT 1 FROM feed_blocklist fb WHERE fb.post_id = OLD.post_id)
BEGIN
    UPDATE feed_posts SET reply_count = reply_count - 1 WHERE post_id = OLD.reply_to;
END;

-- (4) Blocklisting a live reply → decrement its parent. The subquery yields the
-- parent id only when the target is a live reply; otherwise NULL → no row matches.
CREATE TRIGGER IF NOT EXISTS trg_feed_reply_count_blocklist_insert
AFTER INSERT ON feed_blocklist
BEGIN
    UPDATE feed_posts SET reply_count = reply_count - 1
      WHERE post_id = (SELECT reply_to FROM feed_posts
                        WHERE post_id = NEW.post_id
                          AND reply_to != 0 AND deleted = 0 AND hidden = 0);
END;

-- (5) Un-blocklisting a now-live reply → increment its parent.
CREATE TRIGGER IF NOT EXISTS trg_feed_reply_count_blocklist_delete
AFTER DELETE ON feed_blocklist
BEGIN
    UPDATE feed_posts SET reply_count = reply_count + 1
      WHERE post_id = (SELECT reply_to FROM feed_posts
                        WHERE post_id = OLD.post_id
                          AND reply_to != 0 AND deleted = 0 AND hidden = 0);
END;
