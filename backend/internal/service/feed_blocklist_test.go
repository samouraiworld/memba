package service

import (
	"context"
	"testing"

	"connectrpc.com/connect"
	membav1 "github.com/samouraiworld/memba/backend/gen/memba/v1"
)

// The serving-blocklist must suppress a post from EVERY read path — timeline,
// user feed, thread (root + as a reply), and the stats/most-replied counts —
// regardless of its on-chain hidden/deleted state.
func TestFeedBlocklist_ExcludesFromAllReads(t *testing.T) {
	h := setup(t)
	ctx := context.Background()

	seedFeedPost(t, h, 1, "g1a", "clean top-level", 0, false, false)
	seedFeedPost(t, h, 2, "g1b", "illegal top-level", 0, false, false) // → blocklisted
	seedFeedPost(t, h, 3, "g1a", "clean reply", 1, false, false)
	seedFeedPost(t, h, 4, "g1c", "illegal reply", 1, false, false) // → blocklisted

	block := func(id int64) {
		if _, err := h.db.Exec(`INSERT INTO feed_blocklist (post_id, reason, added_by) VALUES (?, 'illegal', 'ops')`, id); err != nil {
			t.Fatal(err)
		}
	}
	block(2)
	block(4)

	ids := func(posts []*membav1.FeedPost) map[uint64]bool {
		m := map[uint64]bool{}
		for _, p := range posts {
			m[p.Id] = true
		}
		return m
	}

	// Timeline excludes the blocklisted top-level post.
	tl, err := h.svc.GetFeedTimeline(ctx, connect.NewRequest(&membav1.GetFeedTimelineRequest{}))
	if err != nil {
		t.Fatal(err)
	}
	if got := ids(tl.Msg.Posts); got[2] || !got[1] {
		t.Fatalf("timeline: blocklisted 2 must be gone, 1 present (got %+v)", got)
	}

	// User feed excludes it.
	uf, err := h.svc.GetUserFeed(ctx, connect.NewRequest(&membav1.GetUserFeedRequest{Author: "g1b"}))
	if err != nil {
		t.Fatal(err)
	}
	if ids(uf.Msg.Posts)[2] {
		t.Fatal("user feed served a blocklisted post")
	}

	// Thread of post 1 excludes the blocklisted reply (4), keeps the clean one (3).
	th, err := h.svc.GetFeedThread(ctx, connect.NewRequest(&membav1.GetFeedThreadRequest{PostId: 1}))
	if err != nil {
		t.Fatal(err)
	}
	if got := ids(th.Msg.Replies); got[4] || !got[3] {
		t.Fatalf("thread replies: blocklisted 4 must be gone, 3 present (got %+v)", got)
	}

	// A blocklisted post as a THREAD ROOT is not served — GetFeedThread 404s (or
	// returns no root). Either way the body is never exposed.
	root, err := h.svc.GetFeedThread(ctx, connect.NewRequest(&membav1.GetFeedThreadRequest{PostId: 2}))
	if err == nil && root.Msg.Root != nil {
		t.Fatal("thread root of a blocklisted post must not be served")
	}

	// Stats counts exclude blocklisted posts (1 live top-level, 1 live reply).
	st, err := h.svc.GetFeedStats(ctx, connect.NewRequest(&membav1.GetFeedStatsRequest{}))
	if err != nil {
		t.Fatal(err)
	}
	if st.Msg.LivePosts != 1 {
		t.Fatalf("stats live_posts = %d, want 1 (2 is blocklisted)", st.Msg.LivePosts)
	}
	if st.Msg.TotalReplies != 1 {
		t.Fatalf("stats total_replies = %d, want 1 (4 is blocklisted)", st.Msg.TotalReplies)
	}
}
