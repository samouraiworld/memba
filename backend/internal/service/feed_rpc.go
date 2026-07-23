package service

import (
	"context"
	"database/sql"
	"log/slog"
	"os"
	"strings"
	"time"

	"connectrpc.com/connect"
	membav1 "github.com/samouraiworld/memba/backend/gen/memba/v1"
	"github.com/samouraiworld/memba/backend/internal/indexer"
)

// feedLimit clamps a requested page size to [1, 100] with a default of 20.
func feedLimit(req uint32) uint32 {
	if req == 0 {
		return 20
	}
	if req > 100 {
		return 100
	}
	return req
}

// u32 clamps a non-negative small count (flag/reply counts) to uint32 for the
// proto. These are non-negative and bounded on-chain (flag threshold, live
// reply cap), so the clamp is defensive; the guard makes it explicit for gosec.
func u32(v int64) uint32 {
	if v < 0 {
		return 0
	}
	if v > int64(^uint32(0)) {
		return ^uint32(0)
	}
	return uint32(v)
}

// scanFeedPosts reads FeedPost rows from a query producing the canonical column
// order. Never returns nil (empty slice on no rows) so the JSON is a stable [].
func scanFeedPosts(rows *sql.Rows) ([]*membav1.FeedPost, error) {
	posts := []*membav1.FeedPost{}
	for rows.Next() {
		var (
			id, replyTo, blockH, blockTs, editedAt, flagCount, replyCount sql.NullInt64
			author, body                                                 sql.NullString
			hidden, deleted                                              sql.NullBool
		)
		if err := rows.Scan(&id, &author, &body, &replyTo, &blockH, &blockTs,
			&editedAt, &flagCount, &hidden, &deleted, &replyCount); err != nil {
			return nil, err
		}
		posts = append(posts, &membav1.FeedPost{
			Id:         u64(id.Int64),
			Author:     author.String,
			Body:       body.String,
			ReplyTo:    u64(replyTo.Int64),
			BlockH:     blockH.Int64,
			BlockTs:    blockTs.Int64,
			EditedAt:   editedAt.Int64,
			FlagCount:  u32(flagCount.Int64),
			Hidden:     hidden.Bool,
			Deleted:    deleted.Bool,
			ReplyCount: u32(replyCount.Int64),
		})
	}
	return posts, rows.Err()
}

// applyViewerFlags sets ViewerHasFlagged on the posts a given viewer
// previously flagged, via one batched query against feed_flags (never N+1).
// No-op — every post stays false — when viewerAddr is empty (anonymous read)
// or posts is empty; this is what keeps GetFeedTimeline/GetFeedThread public
// reads with no address leaking any viewer's state by default (feed v2 plan
// C.1 — replaces the per-mount localStorage state that forgot across reloads).
func applyViewerFlags(ctx context.Context, db *sql.DB, posts []*membav1.FeedPost, viewerAddr string) error {
	if viewerAddr == "" || len(posts) == 0 {
		return nil
	}
	args := make([]any, 0, len(posts)+1)
	args = append(args, viewerAddr)
	placeholders := make([]string, len(posts))
	for i, p := range posts {
		placeholders[i] = "?"
		args = append(args, p.Id)
	}
	q := `SELECT post_id FROM feed_flags WHERE flagger_addr = ? AND post_id IN (` +
		strings.Join(placeholders, ",") + `)`
	rows, err := db.QueryContext(ctx, q, args...)
	if err != nil {
		return err
	}
	defer func() { _ = rows.Close() }()

	flagged := make(map[uint64]bool, len(posts))
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return err
		}
		flagged[u64(id)] = true // post_id is non-negative by construction on-chain (see u64's doc)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	for _, p := range posts {
		if flagged[p.Id] {
			p.ViewerHasFlagged = true
		}
	}
	return nil
}

// feedPostSelect is the shared column list. reply_count is the denormalized
// count of live (not deleted, not hidden, not blocklisted) replies, maintained
// by the triggers in migration 022 — was a per-row correlated subquery (W1.4).
const feedPostSelect = `
	SELECT p.post_id, p.author, p.body, p.reply_to, p.block_h, p.block_ts,
	       p.edited_at, p.flag_count, p.hidden, p.deleted, p.reply_count
	FROM feed_posts p`

// GetFeedTimeline returns the newest visible TOP-LEVEL posts (reply_to = 0),
// id-descending, strictly older than cursor (0 = from the newest). Public read
// — no auth. Replies are seen in a post's thread (GetFeedThread), not inline in
// the home timeline. Serves the indexed projection of memba_feed_v1; the realm
// remains the source of truth.
func (s *MultisigService) GetFeedTimeline(ctx context.Context, req *connect.Request[membav1.GetFeedTimelineRequest]) (*connect.Response[membav1.GetFeedTimelineResponse], error) {
	limit := feedLimit(req.Msg.Limit)
	cursor := req.Msg.Cursor

	// cursor == 0 → newest window; else strictly older than the cursor id.
	q := feedPostSelect + `
		WHERE p.reply_to = 0 AND p.hidden = 0 AND p.deleted = 0 AND NOT EXISTS (SELECT 1 FROM feed_blocklist fb WHERE fb.post_id = p.post_id)`
	args := []any{}
	if cursor != 0 {
		q += ` AND p.post_id < ?`
		args = append(args, cursor)
	}
	q += ` ORDER BY p.post_id DESC LIMIT ?`
	args = append(args, limit)

	rows, err := s.db.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, internalError("GetFeedTimeline", err)
	}
	defer func() { _ = rows.Close() }()

	posts, err := scanFeedPosts(rows)
	if err != nil {
		return nil, internalError("GetFeedTimeline/scan", err)
	}
	if err := applyViewerFlags(ctx, s.db, posts, req.Msg.ViewerAddress); err != nil {
		return nil, internalError("GetFeedTimeline/viewerFlags", err)
	}

	return connect.NewResponse(&membav1.GetFeedTimelineResponse{
		Posts:            posts,
		NextCursor:       nextCursor(posts, limit),
		IndexerLastBlock: indexer.FeedIndexerLastBlock(ctx, s.db),
	}), nil
}

// GetUserFeed returns one author's newest visible posts, strictly older than
// cursor. Public read — no auth.
func (s *MultisigService) GetUserFeed(ctx context.Context, req *connect.Request[membav1.GetUserFeedRequest]) (*connect.Response[membav1.GetUserFeedResponse], error) {
	author := req.Msg.Author
	if author == "" || len(author) > 100 {
		return nil, connect.NewError(connect.CodeInvalidArgument, nil)
	}
	limit := feedLimit(req.Msg.Limit)
	cursor := req.Msg.Cursor

	q := feedPostSelect + `
		WHERE p.author = ? AND p.hidden = 0 AND p.deleted = 0 AND NOT EXISTS (SELECT 1 FROM feed_blocklist fb WHERE fb.post_id = p.post_id)`
	args := []any{author}
	if cursor != 0 {
		q += ` AND p.post_id < ?`
		args = append(args, cursor)
	}
	q += ` ORDER BY p.post_id DESC LIMIT ?`
	args = append(args, limit)

	rows, err := s.db.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, internalError("GetUserFeed", err)
	}
	defer func() { _ = rows.Close() }()

	posts, err := scanFeedPosts(rows)
	if err != nil {
		return nil, internalError("GetUserFeed/scan", err)
	}

	return connect.NewResponse(&membav1.GetUserFeedResponse{
		Posts:      posts,
		NextCursor: nextCursor(posts, limit),
	}), nil
}

// GetFeedThread returns a post plus its live replies in conversation order
// (oldest first), strictly after cursor. The root may be a deleted tombstone so
// replies keep their context. Public read — no auth.
func (s *MultisigService) GetFeedThread(ctx context.Context, req *connect.Request[membav1.GetFeedThreadRequest]) (*connect.Response[membav1.GetFeedThreadResponse], error) {
	postID := req.Msg.PostId
	if postID == 0 {
		return nil, connect.NewError(connect.CodeInvalidArgument, nil)
	}
	limit := feedLimit(req.Msg.Limit)
	cursor := req.Msg.Cursor

	// Root (any state — a deleted parent still anchors its thread).
	rootRows, err := s.db.QueryContext(ctx, feedPostSelect+` WHERE p.post_id = ? AND NOT EXISTS (SELECT 1 FROM feed_blocklist fb WHERE fb.post_id = p.post_id)`, postID)
	if err != nil {
		return nil, internalError("GetFeedThread/root", err)
	}
	rootPosts, err := scanFeedPosts(rootRows)
	_ = rootRows.Close()
	if err != nil {
		return nil, internalError("GetFeedThread/root-scan", err)
	}
	if len(rootPosts) == 0 {
		return nil, connect.NewError(connect.CodeNotFound, nil)
	}

	// Live replies, oldest first, strictly after the cursor.
	q := feedPostSelect + `
		WHERE p.reply_to = ? AND p.hidden = 0 AND p.deleted = 0 AND NOT EXISTS (SELECT 1 FROM feed_blocklist fb WHERE fb.post_id = p.post_id)`
	args := []any{postID}
	if cursor != 0 {
		q += ` AND p.post_id > ?`
		args = append(args, cursor)
	}
	q += ` ORDER BY p.post_id ASC LIMIT ?`
	args = append(args, limit)

	rows, err := s.db.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, internalError("GetFeedThread/replies", err)
	}
	defer func() { _ = rows.Close() }()

	replies, err := scanFeedPosts(rows)
	if err != nil {
		return nil, internalError("GetFeedThread/replies-scan", err)
	}

	// One batched viewer-flag lookup across root + replies together (still a
	// single query, not one per scan call).
	allPosts := make([]*membav1.FeedPost, 0, len(rootPosts)+len(replies))
	allPosts = append(allPosts, rootPosts...)
	allPosts = append(allPosts, replies...)
	if err := applyViewerFlags(ctx, s.db, allPosts, req.Msg.ViewerAddress); err != nil {
		return nil, internalError("GetFeedThread/viewerFlags", err)
	}

	// Ascending order → next cursor is the last (largest) id when the window
	// filled; 0 signals the end. Compare in int space (limit ≤ 100).
	var next uint64
	if len(replies) > 0 && len(replies) == int(limit) {
		next = replies[len(replies)-1].Id
	}

	return connect.NewResponse(&membav1.GetFeedThreadResponse{
		Root:       rootPosts[0],
		Replies:    replies,
		NextCursor: next,
	}), nil
}

// GetFlaggedPosts returns the moderation QUEUE — visible-but-flagged and
// hidden posts (excluding already-deleted or already-blocklisted ones, which
// are resolved and no longer need review) — newest-first, WITH full bodies (a
// moderator has to read what was flagged; contrast GetModerationLog, which is
// deliberately body-free for its public audit-log role).
//
// Because it carries body content of potentially-objectionable posts, this is
// Authorization: Bearer <FEED_MODERATION_BEARER>-gated and FAIL-CLOSED (feed v2
// plan C.3), the same posture and the same secret as the existing
// /api/feed/moderation action endpoint: an unset bearer and a
// missing/mismatched header both reject uniformly, so neither state is
// distinguishable from the outside.
func (s *MultisigService) GetFlaggedPosts(ctx context.Context, req *connect.Request[membav1.GetFlaggedPostsRequest]) (*connect.Response[membav1.GetFlaggedPostsResponse], error) {
	bearer := strings.TrimSpace(os.Getenv("FEED_MODERATION_BEARER"))
	if bearer == "" || !feedModBearerOKHeader(req.Header(), bearer) {
		return nil, connect.NewError(connect.CodeUnauthenticated, nil)
	}

	limit := feedLimit(req.Msg.Limit)
	cursor := req.Msg.Cursor

	q := feedPostSelect + `
		WHERE (p.flag_count > 0 OR p.hidden = 1) AND p.deleted = 0
		AND NOT EXISTS (SELECT 1 FROM feed_blocklist fb WHERE fb.post_id = p.post_id)`
	args := []any{}
	if cursor != 0 {
		q += ` AND p.post_id < ?`
		args = append(args, cursor)
	}
	q += ` ORDER BY p.post_id DESC LIMIT ?`
	args = append(args, limit)

	rows, err := s.db.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, internalError("GetFlaggedPosts", err)
	}
	defer func() { _ = rows.Close() }()

	posts, err := scanFeedPosts(rows)
	if err != nil {
		return nil, internalError("GetFlaggedPosts/scan", err)
	}

	return connect.NewResponse(&membav1.GetFlaggedPostsResponse{
		Posts:      posts,
		NextCursor: nextCursor(posts, limit),
	}), nil
}

// GetReplyNotifications returns live replies to the caller's OWN posts, by
// OTHER people, newest-first — the "someone replied to you" surface. unread is
// the count with id > since_id (the client's last-seen), latest_id advances the
// cursor. Public read — no auth (the address is not a secret; the client asks
// only for its own).
func (s *MultisigService) GetReplyNotifications(ctx context.Context, req *connect.Request[membav1.GetReplyNotificationsRequest]) (*connect.Response[membav1.GetReplyNotificationsResponse], error) {
	author := req.Msg.Author
	if author == "" || len(author) > 100 {
		return nil, connect.NewError(connect.CodeInvalidArgument, nil)
	}
	limit := feedLimit(req.Msg.Limit)

	// A reply r notifies `author` when its parent p was authored by `author`,
	// r is by someone else, and r is live. reply_count is kept for card parity.
	const joinWhere = `
		FROM feed_posts r
		JOIN feed_posts p ON p.post_id = r.reply_to
		WHERE p.author = ? AND r.author != ? AND r.hidden = 0 AND r.deleted = 0 AND NOT EXISTS (SELECT 1 FROM feed_blocklist fb WHERE fb.post_id = r.post_id)`

	q := `
		SELECT r.post_id, r.author, r.body, r.reply_to, r.block_h, r.block_ts,
		       r.edited_at, r.flag_count, r.hidden, r.deleted, r.reply_count` +
		joinWhere + ` ORDER BY r.post_id DESC LIMIT ?`

	rows, err := s.db.QueryContext(ctx, q, author, author, limit)
	if err != nil {
		return nil, internalError("GetReplyNotifications", err)
	}
	defer func() { _ = rows.Close() }()

	replies, err := scanFeedPosts(rows)
	if err != nil {
		return nil, internalError("GetReplyNotifications/scan", err)
	}

	// unread = notifications strictly newer than the client's last-seen id.
	var unread int64
	if err := s.db.QueryRowContext(ctx,
		`SELECT COUNT(*)`+joinWhere+` AND r.post_id > ?`,
		author, author, req.Msg.SinceId,
	).Scan(&unread); err != nil {
		return nil, internalError("GetReplyNotifications/unread", err)
	}

	var latest uint64
	if len(replies) > 0 {
		latest = replies[0].Id // newest-first, so [0] is the max id
	}

	return connect.NewResponse(&membav1.GetReplyNotificationsResponse{
		Replies:     replies,
		UnreadCount: u32(unread),
		LatestId:    latest,
	}), nil
}

// feedStatsTTL is the feed-stats cache window (default 30s, env FEED_STATS_TTL
// as a Go duration). Kept short so the header/rail counters stay near-live.
func feedStatsTTL() time.Duration {
	if v := os.Getenv("FEED_STATS_TTL"); v != "" {
		if d, err := time.ParseDuration(v); err == nil {
			return d
		}
	}
	return 30 * time.Second
}

// cachedFeedStats serves the stats from cache within the TTL, re-assembles on
// expiry under a singleflight, and serves the last-good value if a re-assembly
// errors (stale). Mirrors cachedHomeSnapshot. A cold-cache assemble error is
// propagated (no last-good to fall back on), preserving the pre-cache contract.
func (s *MultisigService) cachedFeedStats(
	ctx context.Context,
	assemble func(context.Context) (*membav1.GetFeedStatsResponse, error),
) (*membav1.GetFeedStatsResponse, error) {
	ttl := feedStatsTTL()

	s.feedStatsMu.RLock()
	cached := s.feedStatsCached
	at := s.feedStatsCachedAt
	s.feedStatsMu.RUnlock()
	if cached != nil && time.Since(at) < ttl {
		return cached, nil // HIT
	}

	// Collapse concurrent misses: only one 4-query fan-out runs at a time; the
	// rest wait and share its result. Prevents a thundering herd of COUNT(*)
	// scans against the DB when the cache expires under a traffic spike.
	v, err, _ := s.feedStatsGroup.Do("feed_stats", func() (any, error) {
		// Re-check under the flight — a just-finished winner may have filled the
		// cache while this goroutine was queued behind it.
		s.feedStatsMu.RLock()
		c := s.feedStatsCached
		cAt := s.feedStatsCachedAt
		s.feedStatsMu.RUnlock()
		if c != nil && time.Since(cAt) < ttl {
			return c, nil
		}

		fresh, err := assemble(ctx) // MISS
		if err != nil {
			return nil, err
		}
		s.feedStatsMu.Lock()
		s.feedStatsCached = fresh
		s.feedStatsCachedAt = time.Now()
		s.feedStatsMu.Unlock()
		return fresh, nil
	})
	if err != nil {
		// Assembly failed — serve the last-good value if we have one (resilience
		// during a transient DB blip under load), else propagate the error.
		s.feedStatsMu.RLock()
		stale := s.feedStatsCached
		s.feedStatsMu.RUnlock()
		if stale != nil {
			slog.Warn("feed stats assemble failed; serving stale", "err", err)
			return stale, nil
		}
		return nil, err
	}
	fresh, _ := v.(*membav1.GetFeedStatsResponse)
	return fresh, nil
}

// assembleFeedStats runs the 3 COUNT(*) + most-replied queries that back the
// feed header/rail. Split out from GetFeedStats so cachedFeedStats can dedupe
// and cache the whole fan-out. All counts exclude hidden + deleted + blocklisted.
func (s *MultisigService) assembleFeedStats(ctx context.Context) (*membav1.GetFeedStatsResponse, error) {
	var livePosts, totalReplies, totalAuthors int64
	if err := s.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM feed_posts WHERE reply_to = 0 AND hidden = 0 AND deleted = 0 AND post_id NOT IN (SELECT post_id FROM feed_blocklist)`).
		Scan(&livePosts); err != nil {
		return nil, internalError("GetFeedStats/posts", err)
	}
	if err := s.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM feed_posts WHERE reply_to != 0 AND hidden = 0 AND deleted = 0 AND post_id NOT IN (SELECT post_id FROM feed_blocklist)`).
		Scan(&totalReplies); err != nil {
		return nil, internalError("GetFeedStats/replies", err)
	}
	if err := s.db.QueryRowContext(ctx,
		`SELECT COUNT(DISTINCT author) FROM feed_posts WHERE hidden = 0 AND deleted = 0 AND post_id NOT IN (SELECT post_id FROM feed_blocklist)`).
		Scan(&totalAuthors); err != nil {
		return nil, internalError("GetFeedStats/authors", err)
	}
	// Most-replied visible top-level posts (trending). Ordered by the
	// denormalized p.reply_count — idx_feed_posts_most_replied
	// (reply_to, hidden, deleted, reply_count DESC, post_id DESC) serves this
	// without a filesort (W1.4). The tiny blocklist residual filter is applied
	// after; the LIMIT 5 keeps it O(1) either way.
	rows, err := s.db.QueryContext(ctx, feedPostSelect+`
		WHERE p.reply_to = 0 AND p.hidden = 0 AND p.deleted = 0 AND NOT EXISTS (SELECT 1 FROM feed_blocklist fb WHERE fb.post_id = p.post_id)
		ORDER BY p.reply_count DESC, p.post_id DESC LIMIT 5`)
	if err != nil {
		return nil, internalError("GetFeedStats/mostReplied", err)
	}
	defer func() { _ = rows.Close() }()
	mostReplied, err := scanFeedPosts(rows)
	if err != nil {
		return nil, internalError("GetFeedStats/mostReplied-scan", err)
	}

	return &membav1.GetFeedStatsResponse{
		LivePosts:    u64(livePosts),
		TotalReplies: u64(totalReplies),
		TotalAuthors: u64(totalAuthors),
		MostReplied:  mostReplied,
	}, nil
}

// GetFeedStats returns feed-wide live counters for the header/rail. Public read
// — no auth. Served from a short-TTL, singleflight-deduped cache so concurrent
// readers (a traffic spike) collapse to one DB fan-out per window.
func (s *MultisigService) GetFeedStats(ctx context.Context, req *connect.Request[membav1.GetFeedStatsRequest]) (*connect.Response[membav1.GetFeedStatsResponse], error) {
	stats, err := s.cachedFeedStats(ctx, s.assembleFeedStats)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(stats), nil
}

// nextCursor returns the paging cursor for a descending window: the last
// (smallest) id when the window filled, else 0 (end reached). Compares in int
// space (limit ≤ 100 by feedLimit).
func nextCursor(posts []*membav1.FeedPost, limit uint32) uint64 {
	if len(posts) == 0 || len(posts) < int(limit) {
		return 0
	}
	return posts[len(posts)-1].Id
}
