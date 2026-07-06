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

	seedFeedPost(t, h, 1, "g1a", "p1", 0, false, false)     // top-level a — gets 2 replies
	seedFeedPost(t, h, 2, "g1b", "p2", 0, false, false)     // top-level b — gets 1 reply
	seedFeedPost(t, h, 3, "g1a", "hidden", 0, true, false)  // hidden top-level → excluded
	seedFeedPost(t, h, 4, "g1c", "reply", 1, false, false)  // reply→1, author c
	seedFeedPost(t, h, 5, "g1a", "reply2", 2, false, false) // reply→2, author a
	seedFeedPost(t, h, 6, "g1d", "gone", 0, false, true)    // deleted → excluded
	seedFeedPost(t, h, 7, "g1e", "reply3", 1, false, false) // reply→1, author e

	resp, err := h.svc.GetFeedStats(ctx, connect.NewRequest(&membav1.GetFeedStatsRequest{}))
	if err != nil {
		t.Fatal(err)
	}
	m := resp.Msg
	if m.LivePosts != 2 { // posts 1, 2
		t.Fatalf("live_posts: got %d want 2", m.LivePosts)
	}
	if m.TotalReplies != 3 { // posts 4, 5, 7
		t.Fatalf("total_replies: got %d want 3", m.TotalReplies)
	}
	if m.TotalAuthors != 4 { // a, b, c, e (d deleted, a's hidden post doesn't add)
		t.Fatalf("total_authors: got %d want 4", m.TotalAuthors)
	}
	// Most-replied: post 1 (2 replies) before post 2 (1 reply); replies excluded.
	if len(m.MostReplied) != 2 {
		t.Fatalf("most_replied: got %d posts want 2", len(m.MostReplied))
	}
	if m.MostReplied[0].Id != 1 || m.MostReplied[0].ReplyCount != 2 {
		t.Fatalf("most_replied[0]: got id=%d count=%d want id=1 count=2", m.MostReplied[0].Id, m.MostReplied[0].ReplyCount)
	}
	if m.MostReplied[1].Id != 2 {
		t.Fatalf("most_replied[1]: got id=%d want 2", m.MostReplied[1].Id)
	}
}
