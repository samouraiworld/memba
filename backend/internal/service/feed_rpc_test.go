package service

import (
	"context"
	"testing"

	"connectrpc.com/connect"
	membav1 "github.com/samouraiworld/memba/backend/gen/memba/v1"
)

// seedFeedPost inserts one feed_posts row directly for handler tests.
func seedFeedPost(t *testing.T, h *testHarness, id int64, author, body string, replyTo int64, hidden, deleted bool) {
	t.Helper()
	hi, de := 0, 0
	if hidden {
		hi = 1
	}
	if deleted {
		de = 1
	}
	_, err := h.db.Exec(`
		INSERT INTO feed_posts
			(post_id, author, body, reply_to, block_h, created_event_block, hidden, deleted)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		id, author, body, replyTo, id, id, hi, de)
	if err != nil {
		t.Fatal("seed feed post:", err)
	}
}

func TestGetFeedTimeline_NewestFirstAndVisibility(t *testing.T) {
	h := setup(t)
	ctx := context.Background()

	seedFeedPost(t, h, 1, "g1a", "first", 0, false, false)
	seedFeedPost(t, h, 2, "g1b", "second", 0, false, false)
	seedFeedPost(t, h, 3, "g1a", "hidden one", 0, true, false)
	seedFeedPost(t, h, 4, "g1b", "deleted one", 0, false, true)
	seedFeedPost(t, h, 5, "g1a", "newest", 0, false, false)

	resp, err := h.svc.GetFeedTimeline(ctx, connect.NewRequest(&membav1.GetFeedTimelineRequest{}))
	if err != nil {
		t.Fatal(err)
	}
	got := resp.Msg.Posts
	// Only visible posts (1,2,5), newest id first.
	if len(got) != 3 {
		t.Fatalf("expected 3 visible posts, got %d", len(got))
	}
	if got[0].Id != 5 || got[1].Id != 2 || got[2].Id != 1 {
		t.Fatalf("wrong order: %d,%d,%d", got[0].Id, got[1].Id, got[2].Id)
	}
	for _, p := range got {
		if p.Hidden || p.Deleted {
			t.Fatal("timeline must omit hidden/deleted posts")
		}
	}
}

func TestGetFeedTimeline_ExcludesReplies(t *testing.T) {
	h := setup(t)
	ctx := context.Background()

	seedFeedPost(t, h, 1, "g1a", "top-level", 0, false, false)
	seedFeedPost(t, h, 2, "g1b", "a reply", 1, false, false) // reply_to = 1

	resp, err := h.svc.GetFeedTimeline(ctx, connect.NewRequest(&membav1.GetFeedTimelineRequest{}))
	if err != nil {
		t.Fatal(err)
	}
	if len(resp.Msg.Posts) != 1 || resp.Msg.Posts[0].Id != 1 {
		t.Fatalf("home timeline must show only top-level posts, got %+v", resp.Msg.Posts)
	}
	// The top-level post reports its one live reply.
	if resp.Msg.Posts[0].ReplyCount != 1 {
		t.Fatalf("reply_count = %d, want 1", resp.Msg.Posts[0].ReplyCount)
	}
}

func TestGetFeedTimeline_CursorPagination(t *testing.T) {
	h := setup(t)
	ctx := context.Background()
	for i := int64(1); i <= 5; i++ {
		seedFeedPost(t, h, i, "g1a", "p", 0, false, false)
	}

	// First window of 2 → ids 5,4; next_cursor = 4.
	r1, err := h.svc.GetFeedTimeline(ctx, connect.NewRequest(&membav1.GetFeedTimelineRequest{Limit: 2}))
	if err != nil {
		t.Fatal(err)
	}
	if len(r1.Msg.Posts) != 2 || r1.Msg.Posts[0].Id != 5 || r1.Msg.Posts[1].Id != 4 {
		t.Fatalf("window 1 wrong: %+v", r1.Msg.Posts)
	}
	if r1.Msg.NextCursor != 4 {
		t.Fatalf("next_cursor = %d, want 4", r1.Msg.NextCursor)
	}

	// Cursor = 4 → strictly older: ids 3,2.
	r2, err := h.svc.GetFeedTimeline(ctx, connect.NewRequest(&membav1.GetFeedTimelineRequest{Cursor: 4, Limit: 2}))
	if err != nil {
		t.Fatal(err)
	}
	if len(r2.Msg.Posts) != 2 || r2.Msg.Posts[0].Id != 3 || r2.Msg.Posts[1].Id != 2 {
		t.Fatalf("window 2 wrong: %+v", r2.Msg.Posts)
	}

	// Last page: id 1, and next_cursor 0 (under-filled → end).
	r3, err := h.svc.GetFeedTimeline(ctx, connect.NewRequest(&membav1.GetFeedTimelineRequest{Cursor: 2, Limit: 2}))
	if err != nil {
		t.Fatal(err)
	}
	if len(r3.Msg.Posts) != 1 || r3.Msg.Posts[0].Id != 1 {
		t.Fatalf("window 3 wrong: %+v", r3.Msg.Posts)
	}
	if r3.Msg.NextCursor != 0 {
		t.Fatalf("next_cursor at end = %d, want 0", r3.Msg.NextCursor)
	}
}

// seedFeedFlag inserts one feed_flags row directly for handler tests.
func seedFeedFlag(t *testing.T, h *testHarness, postID int64, flaggerAddr string, eventBlock int64) {
	t.Helper()
	_, err := h.db.Exec(`
		INSERT INTO feed_flags (post_id, flagger_addr, event_block) VALUES (?, ?, ?)`,
		postID, flaggerAddr, eventBlock)
	if err != nil {
		t.Fatal("seed feed flag:", err)
	}
}

func TestGetFeedTimeline_ViewerHasFlagged(t *testing.T) {
	h := setup(t)
	ctx := context.Background()

	seedFeedPost(t, h, 1, "g1a", "flagged by viewer", 0, false, false)
	seedFeedPost(t, h, 2, "g1b", "flagged by someone else", 0, false, false)
	seedFeedPost(t, h, 3, "g1c", "never flagged", 0, false, false)
	seedFeedFlag(t, h, 1, "g1viewer", 1)
	seedFeedFlag(t, h, 2, "g1other", 2)

	resp, err := h.svc.GetFeedTimeline(ctx, connect.NewRequest(&membav1.GetFeedTimelineRequest{ViewerAddress: "g1viewer"}))
	if err != nil {
		t.Fatal(err)
	}
	byID := map[uint64]*membav1.FeedPost{}
	for _, p := range resp.Msg.Posts {
		byID[p.Id] = p
	}
	if !byID[1].ViewerHasFlagged {
		t.Fatal("post 1 was flagged by the viewer — ViewerHasFlagged must be true")
	}
	if byID[2].ViewerHasFlagged {
		t.Fatal("post 2 was flagged by a DIFFERENT address — ViewerHasFlagged must be false")
	}
	if byID[3].ViewerHasFlagged {
		t.Fatal("post 3 was never flagged — ViewerHasFlagged must be false")
	}

	// No viewer_address (anonymous) → every post reports false, never leaks
	// another viewer's state.
	anon, err := h.svc.GetFeedTimeline(ctx, connect.NewRequest(&membav1.GetFeedTimelineRequest{}))
	if err != nil {
		t.Fatal(err)
	}
	for _, p := range anon.Msg.Posts {
		if p.ViewerHasFlagged {
			t.Fatalf("anonymous request must never report ViewerHasFlagged=true, post %d did", p.Id)
		}
	}
}

func TestGetUserFeed(t *testing.T) {
	h := setup(t)
	ctx := context.Background()
	seedFeedPost(t, h, 1, "g1a", "a1", 0, false, false)
	seedFeedPost(t, h, 2, "g1b", "b1", 0, false, false)
	seedFeedPost(t, h, 3, "g1a", "a2", 0, false, false)

	resp, err := h.svc.GetUserFeed(ctx, connect.NewRequest(&membav1.GetUserFeedRequest{Author: "g1a"}))
	if err != nil {
		t.Fatal(err)
	}
	if len(resp.Msg.Posts) != 2 || resp.Msg.Posts[0].Id != 3 || resp.Msg.Posts[1].Id != 1 {
		t.Fatalf("user feed wrong: %+v", resp.Msg.Posts)
	}

	// Empty author is rejected.
	if _, err := h.svc.GetUserFeed(ctx, connect.NewRequest(&membav1.GetUserFeedRequest{})); err == nil {
		t.Fatal("empty author must be InvalidArgument")
	}
}

func TestGetFeedThread(t *testing.T) {
	h := setup(t)
	ctx := context.Background()

	seedFeedPost(t, h, 1, "g1a", "parent", 0, false, false)
	seedFeedPost(t, h, 2, "g1b", "reply one", 1, false, false)
	seedFeedPost(t, h, 3, "g1c", "reply two", 1, false, false)
	seedFeedPost(t, h, 4, "g1d", "hidden reply", 1, true, false)

	resp, err := h.svc.GetFeedThread(ctx, connect.NewRequest(&membav1.GetFeedThreadRequest{PostId: 1}))
	if err != nil {
		t.Fatal(err)
	}
	if resp.Msg.Root == nil || resp.Msg.Root.Id != 1 {
		t.Fatal("root missing")
	}
	// Live replies oldest-first: 2 then 3; hidden reply omitted.
	if len(resp.Msg.Replies) != 2 || resp.Msg.Replies[0].Id != 2 || resp.Msg.Replies[1].Id != 3 {
		t.Fatalf("replies wrong: %+v", resp.Msg.Replies)
	}
	// reply_count on the root reflects the 2 live replies.
	if resp.Msg.Root.ReplyCount != 2 {
		t.Fatalf("root reply_count = %d, want 2", resp.Msg.Root.ReplyCount)
	}

	// A deleted parent still anchors its thread (tombstone root).
	seedFeedPost(t, h, 10, "g1a", "", 0, false, true)
	seedFeedPost(t, h, 11, "g1b", "orphan reply", 10, false, false)
	tr, err := h.svc.GetFeedThread(ctx, connect.NewRequest(&membav1.GetFeedThreadRequest{PostId: 10}))
	if err != nil {
		t.Fatal(err)
	}
	if !tr.Msg.Root.Deleted || len(tr.Msg.Replies) != 1 {
		t.Fatal("deleted parent must still return as a tombstone root with its replies")
	}

	// Missing post → NotFound; zero id → InvalidArgument.
	if _, err := h.svc.GetFeedThread(ctx, connect.NewRequest(&membav1.GetFeedThreadRequest{PostId: 999})); err == nil {
		t.Fatal("missing thread must be NotFound")
	}
	if _, err := h.svc.GetFeedThread(ctx, connect.NewRequest(&membav1.GetFeedThreadRequest{PostId: 0})); err == nil {
		t.Fatal("zero post id must be InvalidArgument")
	}
}

func TestGetFeedThread_ViewerHasFlagged(t *testing.T) {
	h := setup(t)
	ctx := context.Background()

	seedFeedPost(t, h, 1, "g1a", "root, flagged by viewer", 0, false, false)
	seedFeedPost(t, h, 2, "g1b", "reply, flagged by viewer", 1, false, false)
	seedFeedPost(t, h, 3, "g1c", "reply, not flagged", 1, false, false)
	seedFeedFlag(t, h, 1, "g1viewer", 1)
	seedFeedFlag(t, h, 2, "g1viewer", 2)

	resp, err := h.svc.GetFeedThread(ctx, connect.NewRequest(&membav1.GetFeedThreadRequest{PostId: 1, ViewerAddress: "g1viewer"}))
	if err != nil {
		t.Fatal(err)
	}
	if !resp.Msg.Root.ViewerHasFlagged {
		t.Fatal("root was flagged by the viewer — ViewerHasFlagged must be true")
	}
	if len(resp.Msg.Replies) != 2 {
		t.Fatalf("expected 2 replies, got %d", len(resp.Msg.Replies))
	}
	byID := map[uint64]*membav1.FeedPost{}
	for _, r := range resp.Msg.Replies {
		byID[r.Id] = r
	}
	if !byID[2].ViewerHasFlagged {
		t.Fatal("reply 2 was flagged by the viewer — ViewerHasFlagged must be true")
	}
	if byID[3].ViewerHasFlagged {
		t.Fatal("reply 3 was never flagged — ViewerHasFlagged must be false")
	}

	// Anonymous read (no viewer_address) → root and replies all false.
	anon, err := h.svc.GetFeedThread(ctx, connect.NewRequest(&membav1.GetFeedThreadRequest{PostId: 1}))
	if err != nil {
		t.Fatal(err)
	}
	if anon.Msg.Root.ViewerHasFlagged {
		t.Fatal("anonymous thread read must never report ViewerHasFlagged=true on the root")
	}
	for _, r := range anon.Msg.Replies {
		if r.ViewerHasFlagged {
			t.Fatalf("anonymous thread read must never report ViewerHasFlagged=true, reply %d did", r.Id)
		}
	}
}
