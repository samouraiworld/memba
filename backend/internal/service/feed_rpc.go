package service

import (
	"context"
	"database/sql"

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
			id, replyTo, repostOf, blockH, editedAt, flagCount, replyCount sql.NullInt64
			author, body                                                   sql.NullString
			hidden, deleted                                                sql.NullBool
		)
		if err := rows.Scan(&id, &author, &body, &replyTo, &repostOf, &blockH,
			&editedAt, &flagCount, &hidden, &deleted, &replyCount); err != nil {
			return nil, err
		}
		posts = append(posts, &membav1.FeedPost{
			Id:         u64(id.Int64),
			Author:     author.String,
			Body:       body.String,
			ReplyTo:    u64(replyTo.Int64),
			RepostOf:   u64(repostOf.Int64),
			BlockH:     blockH.Int64,
			EditedAt:   editedAt.Int64,
			FlagCount:  u32(flagCount.Int64),
			Hidden:     hidden.Bool,
			Deleted:    deleted.Bool,
			ReplyCount: u32(replyCount.Int64),
		})
	}
	return posts, rows.Err()
}

// feedPostSelect is the shared column list. reply_count is computed as the
// number of live (not deleted, not hidden) replies indexed under each post.
const feedPostSelect = `
	SELECT p.post_id, p.author, p.body, p.reply_to, p.repost_of, p.block_h,
	       p.edited_at, p.flag_count, p.hidden, p.deleted,
	       (SELECT COUNT(*) FROM feed_posts c
	          WHERE c.reply_to = p.post_id AND c.deleted = 0 AND c.hidden = 0) AS reply_count
	FROM feed_posts p`

// GetFeedTimeline returns the newest visible posts, id-descending, strictly
// older than cursor (0 = from the newest). Public read — no auth. Serves the
// indexed projection of memba_feed_v1; the realm remains the source of truth.
func (s *MultisigService) GetFeedTimeline(ctx context.Context, req *connect.Request[membav1.GetFeedTimelineRequest]) (*connect.Response[membav1.GetFeedTimelineResponse], error) {
	limit := feedLimit(req.Msg.Limit)
	cursor := req.Msg.Cursor

	// cursor == 0 → newest window; else strictly older than the cursor id.
	q := feedPostSelect + `
		WHERE p.hidden = 0 AND p.deleted = 0`
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
		WHERE p.author = ? AND p.hidden = 0 AND p.deleted = 0`
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
	rootRows, err := s.db.QueryContext(ctx, feedPostSelect+` WHERE p.post_id = ?`, postID)
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
		WHERE p.reply_to = ? AND p.hidden = 0 AND p.deleted = 0`
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

// nextCursor returns the paging cursor for a descending window: the last
// (smallest) id when the window filled, else 0 (end reached). Compares in int
// space (limit ≤ 100 by feedLimit).
func nextCursor(posts []*membav1.FeedPost, limit uint32) uint64 {
	if len(posts) == 0 || len(posts) < int(limit) {
		return 0
	}
	return posts[len(posts)-1].Id
}
