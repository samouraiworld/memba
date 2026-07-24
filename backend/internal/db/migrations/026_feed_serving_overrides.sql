-- Out-of-band operator serving override (feed v2 plan C.2). Sibling of
-- feed_blocklist: ops-only, NOT derived from chain events, never written by the
-- indexer, NOT touched by rollbackFeedFromHeight, and it survives a
-- rebuild-from-raw. PRESENCE of a row = force-serve this post to full visibility
-- despite a flag-auto-hide (memba_feed_v1 PostAutoHidden → feed_posts.hidden=1),
-- so a wrongly flag-brigaded post is restored with one bearer curl instead of an
-- on-chain multisig UnhidePost. clear_override deletes the row.
--
-- It can NEVER beat a feed_blocklist row or a deleted tombstone: the read-path
-- precedence resolves those first (blocklist > deleted > serve-override > hidden
-- > live), so an override can never become a blocklist/delete bypass — and
-- couldn't anyway, since a deleted/mod-removed row already has body=''.
CREATE TABLE IF NOT EXISTS feed_serving_overrides (
    post_id  INTEGER PRIMARY KEY,               -- realm post id (top-level or reply)
    reason   TEXT NOT NULL DEFAULT '',
    added_by TEXT NOT NULL DEFAULT '',           -- operator identity for audit
    added_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- The home timeline is served by idx_feed_posts_visible (reply_to, hidden,
-- deleted, post_id DESC), which PINS hidden=0. Honoring a serve-override means a
-- hidden=1 row can now be visible, so the read path can no longer pin hidden in
-- that index and would fall back to "USE TEMP B-TREE FOR ORDER BY" on the feed's
-- hottest query. This index pins the columns that stay equality (reply_to=0,
-- deleted=0) and walks post_id DESC directly; hidden / override / blocklist
-- become residual filters on the tiny survivor set. GetUserFeed and thread
-- replies already residual-filter hidden (idx_feed_posts_author / _parent), so
-- only the home timeline needs this index.
CREATE INDEX IF NOT EXISTS idx_feed_posts_served
    ON feed_posts (reply_to, deleted, post_id DESC);
