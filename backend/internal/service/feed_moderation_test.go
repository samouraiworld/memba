package service

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"connectrpc.com/connect"
	membav1 "github.com/samouraiworld/memba/backend/gen/memba/v1"
)

func TestHandleFeedModeration(t *testing.T) {
	h := setup(t)
	seedFeedPost(t, h, 1, "g1a", "illegal", 0, false, false)
	handler := HandleFeedModeration(h.db)

	call := func(auth, body string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost, "/api/feed/moderation", strings.NewReader(body))
		if auth != "" {
			req.Header.Set("Authorization", auth)
		}
		rr := httptest.NewRecorder()
		handler.ServeHTTP(rr, req)
		return rr
	}
	blocked := func() bool {
		var n int
		if err := h.db.QueryRow(`SELECT COUNT(*) FROM feed_blocklist WHERE post_id = 1`).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n == 1
	}

	// Fail-closed: disabled (404) when the bearer env is unset.
	t.Setenv("FEED_MODERATION_BEARER", "")
	if rr := call("Bearer x", `{"post_id":1,"action":"block"}`); rr.Code != http.StatusNotFound {
		t.Fatalf("disabled should 404, got %d", rr.Code)
	}

	t.Setenv("FEED_MODERATION_BEARER", "s3cret")

	// No / wrong bearer → 401, no mutation.
	if rr := call("", `{"post_id":1,"action":"block"}`); rr.Code != http.StatusUnauthorized {
		t.Fatalf("no auth should 401, got %d", rr.Code)
	}
	if rr := call("Bearer nope", `{"post_id":1,"action":"block"}`); rr.Code != http.StatusUnauthorized {
		t.Fatalf("wrong bearer should 401, got %d", rr.Code)
	}
	if blocked() {
		t.Fatal("unauthorized calls must not mutate the blocklist")
	}

	// Correct bearer + block → 200, row present, post suppressed from the timeline.
	if rr := call("Bearer s3cret", `{"post_id":1,"action":"block","reason":"illegal","by":"ops"}`); rr.Code != http.StatusOK {
		t.Fatalf("block should 200, got %d (%s)", rr.Code, rr.Body.String())
	}
	if !blocked() {
		t.Fatal("block should insert a feed_blocklist row")
	}
	tl, _ := h.svc.GetFeedTimeline(context.Background(), connect.NewRequest(&membav1.GetFeedTimelineRequest{}))
	for _, p := range tl.Msg.Posts {
		if p.Id == 1 {
			t.Fatal("blocklisted post still served by the timeline")
		}
	}

	// Unblock → 200, row gone.
	if rr := call("Bearer s3cret", `{"post_id":1,"action":"unblock"}`); rr.Code != http.StatusOK {
		t.Fatalf("unblock should 200, got %d", rr.Code)
	}
	if blocked() {
		t.Fatal("unblock should remove the row")
	}
}
