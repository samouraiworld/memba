package service

import (
	"context"
	"testing"

	"connectrpc.com/connect"
	membav1 "github.com/samouraiworld/memba/backend/gen/memba/v1"
)

// GetFeedStats counts visible top-level posts, visible replies, and distinct
// authors of visible posts (hidden/deleted excluded throughout).
func TestGetFeedStats(t *testing.T) {
	h := setup(t)
	ctx := context.Background()

	seedFeedPost(t, h, 1, "g1a", "p1", 0, false, false)     // top-level, author a
	seedFeedPost(t, h, 2, "g1b", "p2", 0, false, false)     // top-level, author b
	seedFeedPost(t, h, 3, "g1a", "hidden", 0, true, false)  // hidden top-level → excluded
	seedFeedPost(t, h, 4, "g1c", "reply", 1, false, false)  // reply, author c
	seedFeedPost(t, h, 5, "g1a", "reply2", 2, false, false) // reply, author a
	seedFeedPost(t, h, 6, "g1d", "gone", 0, false, true)    // deleted → excluded

	resp, err := h.svc.GetFeedStats(ctx, connect.NewRequest(&membav1.GetFeedStatsRequest{}))
	if err != nil {
		t.Fatal(err)
	}
	m := resp.Msg
	if m.LivePosts != 2 { // posts 1, 2
		t.Fatalf("live_posts: got %d want 2", m.LivePosts)
	}
	if m.TotalReplies != 2 { // posts 4, 5
		t.Fatalf("total_replies: got %d want 2", m.TotalReplies)
	}
	if m.TotalAuthors != 3 { // a, b, c (d deleted, a's hidden post doesn't add)
		t.Fatalf("total_authors: got %d want 3", m.TotalAuthors)
	}
}
