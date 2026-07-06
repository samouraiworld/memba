package service

import (
	"context"
	"testing"

	"connectrpc.com/connect"
	membav1 "github.com/samouraiworld/memba/backend/gen/memba/v1"
)

// GetReplyNotifications returns live replies to the caller's OWN posts by OTHER
// people, newest-first, with an unread count relative to since_id.
func TestGetReplyNotifications(t *testing.T) {
	h := setup(t)
	ctx := context.Background()

	// g1me authors posts 1 and 2. Others reply; g1me also self-replies.
	seedFeedPost(t, h, 1, "g1me", "my first post", 0, false, false)
	seedFeedPost(t, h, 2, "g1me", "my second post", 0, false, false)
	seedFeedPost(t, h, 3, "g1bob", "nice one", 1, false, false)    // reply to me → notify
	seedFeedPost(t, h, 4, "g1me", "thanks (self)", 1, false, false) // my own reply → NOT a notif
	seedFeedPost(t, h, 5, "g1sue", "hidden reply", 2, true, false)  // hidden → excluded
	seedFeedPost(t, h, 6, "g1sue", "great post", 2, false, false)   // reply to me → notify
	seedFeedPost(t, h, 7, "g1bob", "reply to bob's own", 0, false, false)
	seedFeedPost(t, h, 8, "g1zoe", "on someone else", 7, false, false) // reply to g1bob → not mine

	resp, err := h.svc.GetReplyNotifications(ctx, connect.NewRequest(&membav1.GetReplyNotificationsRequest{
		Author: "g1me", SinceId: 3,
	}))
	if err != nil {
		t.Fatal(err)
	}
	msg := resp.Msg

	// Notifications = posts 3 and 6 (live replies to my posts, not by me), newest first.
	if len(msg.Replies) != 2 {
		t.Fatalf("expected 2 reply notifications, got %d", len(msg.Replies))
	}
	if msg.Replies[0].Id != 6 || msg.Replies[1].Id != 3 {
		t.Fatalf("wrong order/ids: %d, %d", msg.Replies[0].Id, msg.Replies[1].Id)
	}
	// latest_id is the newest notif id.
	if msg.LatestId != 6 {
		t.Fatalf("latest_id: got %d want 6", msg.LatestId)
	}
	// unread = replies with id > since_id(3): only id 6.
	if msg.UnreadCount != 1 {
		t.Fatalf("unread_count: got %d want 1", msg.UnreadCount)
	}
}

func TestGetReplyNotifications_EmptyAuthorRejected(t *testing.T) {
	h := setup(t)
	_, err := h.svc.GetReplyNotifications(context.Background(),
		connect.NewRequest(&membav1.GetReplyNotificationsRequest{Author: ""}))
	if err == nil {
		t.Fatal("expected InvalidArgument for an empty author")
	}
}
