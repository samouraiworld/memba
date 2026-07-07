package service

import (
	"context"
	"strings"

	"connectrpc.com/connect"
	membav1 "github.com/samouraiworld/memba/backend/gen/memba/v1"
)

// maxReactionPosts caps how many posts one GetPostReactions call aggregates —
// the frontend batches the visible page, so a screenful is plenty and the IN
// clause stays bounded.
const maxReactionPosts = 100

// GetPostReactions returns per-emoji reaction counts for the requested posts,
// count-descending, and (when a viewer is supplied) which emojis that wallet
// reacted with. Public read, no auth — aggregated from the feed_reactions
// projection the indexer maintains from the realm's Reaction* events.
func (s *MultisigService) GetPostReactions(ctx context.Context, req *connect.Request[membav1.GetPostReactionsRequest]) (*connect.Response[membav1.GetPostReactionsResponse], error) {
	ids := req.Msg.PostIds
	if len(ids) == 0 {
		return connect.NewResponse(&membav1.GetPostReactionsResponse{}), nil
	}
	if len(ids) > maxReactionPosts {
		ids = ids[:maxReactionPosts]
	}
	viewer := req.Msg.Viewer

	// args: the viewer (for the SELECT's viewer-reacted sum) first, then the IN ids.
	placeholders := make([]string, len(ids))
	args := make([]any, 0, len(ids)+1)
	args = append(args, viewer)
	for i, id := range ids {
		placeholders[i] = "?"
		args = append(args, id)
	}

	// #nosec G202 -- the only concatenated fragment is a run of literal "?"
	// placeholders (len == len(ids)); every value (viewer + ids) is bound via args.
	rows, err := s.db.QueryContext(ctx, `
		SELECT post_id, emoji, COUNT(*) AS c,
		       SUM(CASE WHEN reactor = ? THEN 1 ELSE 0 END) AS viewer_reacted
		FROM feed_reactions
		WHERE post_id IN (`+strings.Join(placeholders, ",")+`)
		GROUP BY post_id, emoji
		ORDER BY post_id, c DESC, emoji`, args...)
	if err != nil {
		return nil, internalError("GetPostReactions", err)
	}
	defer rows.Close() //nolint:errcheck

	byPost := make(map[uint64]*membav1.PostReactions, len(ids))
	order := make([]uint64, 0, len(ids))
	for rows.Next() {
		var pid, count uint64
		var emoji string
		var viewerReacted int64
		if err := rows.Scan(&pid, &emoji, &count, &viewerReacted); err != nil {
			return nil, internalError("GetPostReactions/scan", err)
		}
		pr, ok := byPost[pid]
		if !ok {
			pr = &membav1.PostReactions{PostId: pid}
			byPost[pid] = pr
			order = append(order, pid)
		}
		pr.Reactions = append(pr.Reactions, &membav1.EmojiCount{
			Emoji:         emoji,
			Count:         count,
			ViewerReacted: viewer != "" && viewerReacted > 0,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, internalError("GetPostReactions/rows", err)
	}

	resp := &membav1.GetPostReactionsResponse{}
	for _, pid := range order {
		resp.Posts = append(resp.Posts, byPost[pid])
	}
	return connect.NewResponse(resp), nil
}
