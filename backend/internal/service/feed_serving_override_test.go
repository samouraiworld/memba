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

// seedOverride force-serves a post via the out-of-band override table (test helper).
func seedOverride(t *testing.T, h *testHarness, id int64) {
	t.Helper()
	if _, err := h.db.Exec(`INSERT INTO feed_serving_overrides (post_id, reason, added_by) VALUES (?, 'restore', 'ops')`, id); err != nil {
		t.Fatal("seed override:", err)
	}
}

// blocklist a post directly (test helper).
func seedBlocklist(t *testing.T, h *testHarness, id int64) {
	t.Helper()
	if _, err := h.db.Exec(`INSERT INTO feed_blocklist (post_id, reason, added_by) VALUES (?, 'illegal', 'ops')`, id); err != nil {
		t.Fatal("seed blocklist:", err)
	}
}

func overrideCount(t *testing.T, h *testHarness, id int64) int {
	t.Helper()
	var n int
	if err := h.db.QueryRow(`SELECT COUNT(*) FROM feed_serving_overrides WHERE post_id = ?`, id).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func TestHandleFeedModeration_ServeOverride(t *testing.T) {
	h := setup(t)
	seedFeedPost(t, h, 1, "g1a", "brigaded but legit", 0, true, false) // flag-auto-hidden
	seedFeedPost(t, h, 2, "g1b", "", 0, false, true)                   // deleted tombstone
	seedFeedPost(t, h, 3, "g1c", "illegal", 0, false, false)           // blocklisted below
	seedBlocklist(t, h, 3)
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

	t.Setenv("FEED_MODERATION_BEARER", "s3cret")

	// Wrong bearer → 401, no mutation (gate is shared with block/unblock).
	if rr := call("Bearer nope", `{"post_id":1,"action":"override_serve"}`); rr.Code != http.StatusUnauthorized {
		t.Fatalf("wrong bearer should 401, got %d", rr.Code)
	}
	if overrideCount(t, h, 1) != 0 {
		t.Fatal("unauthorized override_serve must not write a row")
	}

	// override_serve a flag-hidden post → 200, exactly one row; idempotent on repeat.
	if rr := call("Bearer s3cret", `{"post_id":1,"action":"override_serve","reason":"false positive","by":"ops"}`); rr.Code != http.StatusOK {
		t.Fatalf("override_serve should 200, got %d (%s)", rr.Code, rr.Body.String())
	}
	if overrideCount(t, h, 1) != 1 {
		t.Fatal("override_serve should insert a feed_serving_overrides row")
	}
	if rr := call("Bearer s3cret", `{"post_id":1,"action":"override_serve","by":"ops2"}`); rr.Code != http.StatusOK {
		t.Fatalf("repeat override_serve should 200, got %d", rr.Code)
	}
	if overrideCount(t, h, 1) != 1 {
		t.Fatal("override_serve must be idempotent (one row per post)")
	}

	// clear_override → 200, row gone; repeat is a harmless no-op 200.
	if rr := call("Bearer s3cret", `{"post_id":1,"action":"clear_override"}`); rr.Code != http.StatusOK {
		t.Fatalf("clear_override should 200, got %d", rr.Code)
	}
	if overrideCount(t, h, 1) != 0 {
		t.Fatal("clear_override should delete the row")
	}
	if rr := call("Bearer s3cret", `{"post_id":1,"action":"clear_override"}`); rr.Code != http.StatusOK {
		t.Fatalf("idempotent clear_override should 200, got %d", rr.Code)
	}

	// override_serve must REFUSE a deleted tombstone and a blocklisted post (409)
	// and write nothing — an override can never resurrect that content.
	if rr := call("Bearer s3cret", `{"post_id":2,"action":"override_serve","by":"ops"}`); rr.Code != http.StatusConflict {
		t.Fatalf("override_serve on deleted should 409, got %d", rr.Code)
	}
	if rr := call("Bearer s3cret", `{"post_id":3,"action":"override_serve","by":"ops"}`); rr.Code != http.StatusConflict {
		t.Fatalf("override_serve on blocklisted should 409, got %d", rr.Code)
	}
	if overrideCount(t, h, 2) != 0 || overrideCount(t, h, 3) != 0 {
		t.Fatal("refused override_serve must not write a row")
	}
}

// A serve-override must target a post that actually EXISTS — you can't vouch for
// content you haven't seen. A pre-emptive override on a not-yet-indexed id would
// otherwise auto-restore that post the moment it arrives and gets flag-hidden,
// with no fresh human review. (Blocklist stays pre-emptive: suppression is the
// safe direction.)
func TestHandleFeedModeration_ServeOverrideRejectsNonexistent(t *testing.T) {
	h := setup(t)
	handler := HandleFeedModeration(h.db)
	t.Setenv("FEED_MODERATION_BEARER", "s3cret")

	req := httptest.NewRequest(http.MethodPost, "/api/feed/moderation",
		strings.NewReader(`{"post_id":999,"action":"override_serve","by":"ops"}`))
	req.Header.Set("Authorization", "Bearer s3cret")
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusConflict {
		t.Fatalf("override_serve on a non-existent post should 409, got %d", rr.Code)
	}
	if overrideCount(t, h, 999) != 0 {
		t.Fatal("override_serve on a non-existent post must not write a row")
	}
}

func TestHandleFeedModeration_BlockClearsOverride(t *testing.T) {
	h := setup(t)
	seedFeedPost(t, h, 1, "g1a", "was restored, now must go", 0, true, false)
	seedOverride(t, h, 1) // an operator had force-served it
	handler := HandleFeedModeration(h.db)
	t.Setenv("FEED_MODERATION_BEARER", "s3cret")

	req := httptest.NewRequest(http.MethodPost, "/api/feed/moderation",
		strings.NewReader(`{"post_id":1,"action":"block","reason":"illegal","by":"ops"}`))
	req.Header.Set("Authorization", "Bearer s3cret")
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("block should 200, got %d", rr.Code)
	}
	// Block is authoritative: it must drop any serving override so a later unblock
	// can't resurrect the post as overridden-visible (G9).
	if overrideCount(t, h, 1) != 0 {
		t.Fatal("block must clear any existing serving override")
	}
}

func TestGetFeedTimeline_ServeOverridePrecedence(t *testing.T) {
	h := setup(t)
	ctx := context.Background()

	seedFeedPost(t, h, 1, "g1a", "live", 0, false, false)                    // live → visible
	seedFeedPost(t, h, 2, "g1b", "flag-hidden, no override", 0, true, false) // stays hidden (as today)
	seedFeedPost(t, h, 3, "g1c", "flag-hidden, overridden", 0, true, false)  // → restored to visible
	seedOverride(t, h, 3)
	seedFeedPost(t, h, 4, "g1d", "hidden + blocklisted", 0, true, false) // blocklist > override → hidden
	seedBlocklist(t, h, 4)
	seedOverride(t, h, 4)
	seedFeedPost(t, h, 5, "g1e", "", 0, false, true) // deleted > override → tombstone
	seedOverride(t, h, 5)

	resp, err := h.svc.GetFeedTimeline(ctx, connect.NewRequest(&membav1.GetFeedTimelineRequest{}))
	if err != nil {
		t.Fatal(err)
	}
	got := map[uint64]*membav1.FeedPost{}
	for _, p := range resp.Msg.Posts {
		got[p.Id] = p
	}

	if _, ok := got[1]; !ok {
		t.Fatal("live post 1 must be served")
	}
	if _, ok := got[2]; ok {
		t.Fatal("flag-hidden post 2 (no override) must stay hidden, exactly as today")
	}
	p3, ok := got[3]
	if !ok {
		t.Fatal("overridden flag-hidden post 3 must be served (the anti-brigade restore)")
	}
	if p3.Hidden {
		t.Fatal("overridden post 3 must present Hidden=false so it renders as a normal restored post")
	}
	if p3.Body != "flag-hidden, overridden" {
		t.Fatalf("overridden post 3 must serve its full body, got %q", p3.Body)
	}
	if _, ok := got[4]; ok {
		t.Fatal("blocklisted post 4 must stay hidden even with an override (blocklist > override)")
	}
	if _, ok := got[5]; ok {
		t.Fatal("deleted post 5 must stay a tombstone even with an override (deleted > override)")
	}
}

func TestGetUserFeed_ServeOverride(t *testing.T) {
	h := setup(t)
	ctx := context.Background()
	seedFeedPost(t, h, 1, "g1a", "live", 0, false, false)
	seedFeedPost(t, h, 2, "g1a", "flag-hidden no override", 0, true, false)
	seedFeedPost(t, h, 3, "g1a", "flag-hidden overridden", 0, true, false)
	seedOverride(t, h, 3)

	resp, err := h.svc.GetUserFeed(ctx, connect.NewRequest(&membav1.GetUserFeedRequest{Author: "g1a"}))
	if err != nil {
		t.Fatal(err)
	}
	got := map[uint64]*membav1.FeedPost{}
	for _, p := range resp.Msg.Posts {
		got[p.Id] = p
	}
	if _, ok := got[2]; ok {
		t.Fatal("flag-hidden post 2 (no override) must stay hidden in the author's feed")
	}
	p3, ok := got[3]
	if !ok {
		t.Fatal("overridden post 3 must be served in the author's feed")
	}
	if p3.Hidden {
		t.Fatal("overridden post 3 must present Hidden=false in the author's feed")
	}
}

func TestGetFeedThread_ServeOverride(t *testing.T) {
	h := setup(t)
	ctx := context.Background()
	seedFeedPost(t, h, 10, "g1a", "root: flag-hidden overridden", 0, true, false)
	seedOverride(t, h, 10)
	seedFeedPost(t, h, 11, "g1b", "reply: flag-hidden overridden", 10, true, false)
	seedOverride(t, h, 11)
	seedFeedPost(t, h, 12, "g1c", "reply: flag-hidden no override", 10, true, false)
	seedFeedPost(t, h, 13, "g1d", "reply: live", 10, false, false)

	resp, err := h.svc.GetFeedThread(ctx, connect.NewRequest(&membav1.GetFeedThreadRequest{PostId: 10}))
	if err != nil {
		t.Fatal(err)
	}
	if resp.Msg.Root.Hidden {
		t.Fatal("overridden root must present Hidden=false (renders as a normal restored post)")
	}
	if resp.Msg.Root.Body != "root: flag-hidden overridden" {
		t.Fatalf("overridden root must serve its full body, got %q", resp.Msg.Root.Body)
	}
	got := map[uint64]*membav1.FeedPost{}
	for _, p := range resp.Msg.Replies {
		got[p.Id] = p
	}
	if _, ok := got[12]; ok {
		t.Fatal("flag-hidden reply 12 (no override) must stay excluded from the thread")
	}
	if p, ok := got[11]; !ok {
		t.Fatal("overridden reply 11 must be served")
	} else if p.Hidden {
		t.Fatal("overridden reply 11 must present Hidden=false")
	}
	if _, ok := got[13]; !ok {
		t.Fatal("live reply 13 must be served")
	}
}

func TestGetFeedThread_FlagHiddenRootStaysTombstoneWithoutOverride(t *testing.T) {
	h := setup(t)
	ctx := context.Background()
	seedFeedPost(t, h, 20, "g1a", "still under review", 0, true, false) // flag-hidden, no override

	resp, err := h.svc.GetFeedThread(ctx, connect.NewRequest(&membav1.GetFeedThreadRequest{PostId: 20}))
	if err != nil {
		t.Fatal(err)
	}
	if !resp.Msg.Root.Hidden {
		t.Fatal("flag-hidden root without an override must present Hidden=true (tombstone, exactly as today)")
	}
}

// A deleted post that ALSO carries a (stale/inert) override stays a tombstone as a
// thread root: Deleted=true and body=” — the deleted tombstone outranks the
// override on every path. Locks the invariant that keeps the Deleted=true,
// Hidden=false combo safe (delete wipes the body).
func TestGetFeedThread_DeletedRootWithOverrideStaysTombstone(t *testing.T) {
	h := setup(t)
	ctx := context.Background()
	seedFeedPost(t, h, 30, "g1a", "", 0, false, true) // deleted (body already wiped by the projection)
	seedOverride(t, h, 30)

	resp, err := h.svc.GetFeedThread(ctx, connect.NewRequest(&membav1.GetFeedThreadRequest{PostId: 30}))
	if err != nil {
		t.Fatal(err)
	}
	if !resp.Msg.Root.Deleted {
		t.Fatal("a deleted root must stay Deleted=true even with an override")
	}
	if resp.Msg.Root.Body != "" {
		t.Fatalf("a deleted root must serve no body, got %q", resp.Msg.Root.Body)
	}
}

// Cursor pagination stays correct across the widened timeline query: an overridden
// (restored) post pages in id-descending order like any live post, with no skip or
// duplicate at a page boundary.
func TestGetFeedTimeline_ServeOverridePagination(t *testing.T) {
	h := setup(t)
	ctx := context.Background()
	seedFeedPost(t, h, 1, "g1a", "p1", 0, false, false)
	seedFeedPost(t, h, 2, "g1a", "p2", 0, false, false)
	seedFeedPost(t, h, 3, "g1a", "p3 restored", 0, true, false) // flag-hidden…
	seedOverride(t, h, 3)                                       // …but restored
	seedFeedPost(t, h, 4, "g1a", "p4", 0, false, false)
	seedFeedPost(t, h, 5, "g1a", "p5", 0, false, false)

	var ids []uint64
	var cursor uint64
	for {
		resp, err := h.svc.GetFeedTimeline(ctx, connect.NewRequest(&membav1.GetFeedTimelineRequest{Limit: 2, Cursor: cursor}))
		if err != nil {
			t.Fatal(err)
		}
		for _, p := range resp.Msg.Posts {
			ids = append(ids, p.Id)
		}
		if resp.Msg.NextCursor == 0 {
			break
		}
		cursor = resp.Msg.NextCursor
	}
	want := []uint64{5, 4, 3, 2, 1} // all visible (3 restored), newest-first, no dup/skip
	if len(ids) != len(want) {
		t.Fatalf("paged ids = %v, want %v", ids, want)
	}
	for i := range want {
		if ids[i] != want[i] {
			t.Fatalf("paged ids = %v, want %v", ids, want)
		}
	}
}

// The widened home-timeline read (hidden=0 can no longer be pinned in the index)
// must still be served by idx_feed_posts_served without a TEMP B-TREE sort on the
// feed's hottest query. Builds the EXACT query the code runs from the real
// constants so the guard tracks the implementation.
func TestGetFeedTimeline_ServedQueryUsesIndexNoSort(t *testing.T) {
	h := setup(t)
	for i := int64(1); i <= 5; i++ {
		seedFeedPost(t, h, i, "g1a", "post", 0, false, false)
	}
	q := feedPostServedSelect + ` WHERE p.reply_to = 0 AND ` + feedServedVisibility + ` ORDER BY p.post_id DESC LIMIT 20`

	rows, err := h.db.Query("EXPLAIN QUERY PLAN " + q)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = rows.Close() }()
	var plan strings.Builder
	for rows.Next() {
		var id, parent, notused int
		var detail string
		if err := rows.Scan(&id, &parent, &notused, &detail); err != nil {
			t.Fatal(err)
		}
		plan.WriteString(detail + "\n")
	}
	got := plan.String()
	if strings.Contains(got, "USE TEMP B-TREE") {
		t.Fatalf("home-timeline query must not filesort:\n%s", got)
	}
	if !strings.Contains(got, "idx_feed_posts_served") {
		t.Fatalf("home-timeline query must use idx_feed_posts_served:\n%s", got)
	}
}

// Isolation (G5): a serve-override restores a post to the pull surfaces
// (timeline/thread) but must NEVER leak into the aggregate counters/trending or
// the push notification surface — those stay on the organic hidden=0 count.
func TestGetFeedStats_ExcludesOverridden(t *testing.T) {
	h := setup(t)
	ctx := context.Background()
	seedFeedPost(t, h, 1, "g1a", "live", 0, false, false)
	seedFeedPost(t, h, 2, "g1b", "flag-hidden overridden", 0, true, false)
	seedOverride(t, h, 2)

	resp, err := h.svc.GetFeedStats(ctx, connect.NewRequest(&membav1.GetFeedStatsRequest{}))
	if err != nil {
		t.Fatal(err)
	}
	if resp.Msg.LivePosts != 1 {
		t.Fatalf("LivePosts must count only the organic-live post (1), got %d", resp.Msg.LivePosts)
	}
	for _, p := range resp.Msg.MostReplied {
		if p.Id == 2 {
			t.Fatal("an overridden post must not appear in most-replied/trending")
		}
	}
}

// reply_count stays the ORGANIC-live count (maintained by the 022 triggers on
// feed_posts.hidden/deleted): a serve-override writes only the out-of-band table,
// so it must never move a parent's reply_count.
func TestServeOverride_DoesNotChangeReplyCount(t *testing.T) {
	h := setup(t)
	seedFeedPost(t, h, 1, "g1a", "parent", 0, false, false)
	seedFeedPost(t, h, 2, "g1b", "reply", 1, false, false)

	var before int
	if err := h.db.QueryRow(`SELECT reply_count FROM feed_posts WHERE post_id=1`).Scan(&before); err != nil {
		t.Fatal(err)
	}
	seedOverride(t, h, 2)
	var after int
	if err := h.db.QueryRow(`SELECT reply_count FROM feed_posts WHERE post_id=1`).Scan(&after); err != nil {
		t.Fatal(err)
	}
	if before != after {
		t.Fatalf("an override must not change reply_count (organic-live semantic): before=%d after=%d", before, after)
	}
}

func TestGetReplyNotifications_ExcludesOverridden(t *testing.T) {
	h := setup(t)
	ctx := context.Background()
	seedFeedPost(t, h, 1, "g1a", "author's post", 0, false, false)
	seedFeedPost(t, h, 2, "g1b", "flag-hidden overridden reply", 1, true, false)
	seedOverride(t, h, 2)

	resp, err := h.svc.GetReplyNotifications(ctx, connect.NewRequest(&membav1.GetReplyNotificationsRequest{Author: "g1a"}))
	if err != nil {
		t.Fatal(err)
	}
	for _, p := range resp.Msg.Replies {
		if p.Id == 2 {
			t.Fatal("an overridden reply must not push a reply notification (pull-only isolation)")
		}
	}
	if resp.Msg.UnreadCount != 0 {
		t.Fatalf("an overridden reply must not count as unread, got %d", resp.Msg.UnreadCount)
	}
}
