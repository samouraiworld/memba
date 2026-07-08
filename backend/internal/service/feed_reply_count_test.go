package service

import (
	"context"
	"testing"

	"connectrpc.com/connect"
	membav1 "github.com/samouraiworld/memba/backend/gen/memba/v1"
)

// W1.4 — the denormalized feed_posts.reply_count column must track the live-reply
// definition (reply_to!=0 AND deleted=0 AND hidden=0 AND not blocklisted) across
// every mutation the indexer can apply, maintained by SQL triggers. These tests
// read the column directly (trigger correctness) and through the RPC (behaviour
// parity with the old correlated subquery).

// replyCountCol reads the stored reply_count for one post id.
func replyCountCol(t *testing.T, h *testHarness, postID int64) int64 {
	t.Helper()
	var n int64
	if err := h.db.QueryRow(`SELECT reply_count FROM feed_posts WHERE post_id = ?`, postID).Scan(&n); err != nil {
		t.Fatalf("read reply_count(%d): %v", postID, err)
	}
	return n
}

// hideReply / deleteReply / setHidden mirror the indexer's dispatch UPDATEs.
func setHidden(t *testing.T, h *testHarness, id int64, hidden int) {
	t.Helper()
	if _, err := h.db.Exec(`UPDATE feed_posts SET hidden = ? WHERE post_id = ?`, hidden, id); err != nil {
		t.Fatal("set hidden:", err)
	}
}

func markDeleted(t *testing.T, h *testHarness, id int64) {
	t.Helper()
	if _, err := h.db.Exec(`UPDATE feed_posts SET deleted = 1 WHERE post_id = ? AND deleted = 0`, id); err != nil {
		t.Fatal("mark deleted:", err)
	}
}

func blocklist(t *testing.T, h *testHarness, id int64) {
	t.Helper()
	if _, err := h.db.Exec(`INSERT INTO feed_blocklist (post_id, reason, added_by) VALUES (?, 'x', 'ops')`, id); err != nil {
		t.Fatal("blocklist:", err)
	}
}

func unblocklist(t *testing.T, h *testHarness, id int64) {
	t.Helper()
	if _, err := h.db.Exec(`DELETE FROM feed_blocklist WHERE post_id = ?`, id); err != nil {
		t.Fatal("unblocklist:", err)
	}
}

func TestReplyCount_InsertIncrementsLiveOnly(t *testing.T) {
	h := setup(t)
	seedFeedPost(t, h, 1, "g1a", "parent", 0, false, false)
	seedFeedPost(t, h, 2, "g1b", "live reply", 1, false, false)
	seedFeedPost(t, h, 3, "g1c", "hidden reply", 1, true, false)  // hidden at insert
	seedFeedPost(t, h, 4, "g1d", "deleted reply", 1, false, true) // deleted at insert

	// Only the one live reply counts.
	if got := replyCountCol(t, h, 1); got != 1 {
		t.Fatalf("parent reply_count = %d, want 1 (hidden/deleted inserts must not count)", got)
	}
}

func TestReplyCount_HideUnhideDeleteTransitions(t *testing.T) {
	h := setup(t)
	seedFeedPost(t, h, 1, "g1a", "parent", 0, false, false)
	seedFeedPost(t, h, 2, "g1b", "r2", 1, false, false)
	seedFeedPost(t, h, 3, "g1c", "r3", 1, false, false)
	if got := replyCountCol(t, h, 1); got != 2 {
		t.Fatalf("after 2 live replies: %d, want 2", got)
	}

	setHidden(t, h, 2, 1) // hide r2
	if got := replyCountCol(t, h, 1); got != 1 {
		t.Fatalf("after hide: %d, want 1", got)
	}
	setHidden(t, h, 2, 0) // unhide r2
	if got := replyCountCol(t, h, 1); got != 2 {
		t.Fatalf("after unhide: %d, want 2", got)
	}
	markDeleted(t, h, 3) // delete r3
	if got := replyCountCol(t, h, 1); got != 1 {
		t.Fatalf("after delete: %d, want 1", got)
	}
}

func TestReplyCount_HideIsIdempotent(t *testing.T) {
	h := setup(t)
	seedFeedPost(t, h, 1, "g1a", "parent", 0, false, false)
	seedFeedPost(t, h, 2, "g1b", "r2", 1, false, false)

	// Re-applying the same hide value (as the indexer does on tail re-processing)
	// must not drift the counter — the trigger keys off OLD vs NEW.
	setHidden(t, h, 2, 1)
	setHidden(t, h, 2, 1)
	setHidden(t, h, 2, 1)
	if got := replyCountCol(t, h, 1); got != 0 {
		t.Fatalf("after repeated hide: %d, want 0", got)
	}
	setHidden(t, h, 2, 0)
	setHidden(t, h, 2, 0)
	if got := replyCountCol(t, h, 1); got != 1 {
		t.Fatalf("after repeated unhide: %d, want 1", got)
	}
}

func TestReplyCount_BlocklistTransitions(t *testing.T) {
	h := setup(t)
	seedFeedPost(t, h, 1, "g1a", "parent", 0, false, false)
	seedFeedPost(t, h, 2, "g1b", "r2", 1, false, false)
	seedFeedPost(t, h, 3, "g1c", "r3", 1, false, false)
	if got := replyCountCol(t, h, 1); got != 2 {
		t.Fatalf("baseline: %d, want 2", got)
	}

	blocklist(t, h, 2) // suppress r2
	if got := replyCountCol(t, h, 1); got != 1 {
		t.Fatalf("after blocklist: %d, want 1", got)
	}
	unblocklist(t, h, 2) // un-suppress r2
	if got := replyCountCol(t, h, 1); got != 2 {
		t.Fatalf("after un-blocklist: %d, want 2", got)
	}
}

func TestReplyCount_BlocklistThenHideNoDoubleCount(t *testing.T) {
	h := setup(t)
	seedFeedPost(t, h, 1, "g1a", "parent", 0, false, false)
	seedFeedPost(t, h, 2, "g1b", "r2", 1, false, false)
	if got := replyCountCol(t, h, 1); got != 1 {
		t.Fatalf("baseline: %d, want 1", got)
	}

	// Blocklist drops it to 0; hiding an already-suppressed reply must NOT
	// decrement again (it wasn't counted), and un-blocklisting a hidden reply
	// must not resurrect it.
	blocklist(t, h, 2)
	if got := replyCountCol(t, h, 1); got != 0 {
		t.Fatalf("after blocklist: %d, want 0", got)
	}
	setHidden(t, h, 2, 1)
	if got := replyCountCol(t, h, 1); got != 0 {
		t.Fatalf("after hide-while-blocklisted: %d, want 0 (no double decrement)", got)
	}
	unblocklist(t, h, 2)
	if got := replyCountCol(t, h, 1); got != 0 {
		t.Fatalf("after un-blocklist-while-hidden: %d, want 0 (still hidden)", got)
	}
	setHidden(t, h, 2, 0)
	if got := replyCountCol(t, h, 1); got != 1 {
		t.Fatalf("after unhide: %d, want 1", got)
	}
}

func TestReplyCount_ReorgDeleteDecrements(t *testing.T) {
	h := setup(t)
	seedFeedPost(t, h, 1, "g1a", "parent", 0, false, false)
	seedFeedPost(t, h, 2, "g1b", "r2", 1, false, false)
	if got := replyCountCol(t, h, 1); got != 1 {
		t.Fatalf("baseline: %d, want 1", got)
	}

	// The feed tailer rolls back a reorg with a physical DELETE of rows created
	// in the rolled-back blocks. A live reply's deletion must decrement its parent.
	if _, err := h.db.Exec(`DELETE FROM feed_posts WHERE post_id = 2`); err != nil {
		t.Fatal("reorg delete:", err)
	}
	if got := replyCountCol(t, h, 1); got != 0 {
		t.Fatalf("after reorg delete: %d, want 0", got)
	}
}

func TestReplyCount_RPCReflectsColumnThroughMutations(t *testing.T) {
	h := setup(t)
	ctx := context.Background()
	seedFeedPost(t, h, 1, "g1a", "parent", 0, false, false)
	seedFeedPost(t, h, 2, "g1b", "r2", 1, false, false)
	seedFeedPost(t, h, 3, "g1c", "r3", 1, false, false)

	thread := func() uint32 {
		resp, err := h.svc.GetFeedThread(ctx, connect.NewRequest(&membav1.GetFeedThreadRequest{PostId: 1}))
		if err != nil {
			t.Fatal(err)
		}
		return resp.Msg.Root.ReplyCount
	}
	if got := thread(); got != 2 {
		t.Fatalf("root reply_count via RPC = %d, want 2", got)
	}
	setHidden(t, h, 2, 1)
	if got := thread(); got != 1 {
		t.Fatalf("root reply_count after hide = %d, want 1", got)
	}
	blocklist(t, h, 3)
	if got := thread(); got != 0 {
		t.Fatalf("root reply_count after blocklist = %d, want 0", got)
	}
}

func TestReplyCount_StatsMostRepliedOrdered(t *testing.T) {
	h := setup(t)
	ctx := context.Background()
	// Three top-level posts with 0, 2, 1 live replies respectively.
	seedFeedPost(t, h, 1, "g1a", "p1", 0, false, false)
	seedFeedPost(t, h, 2, "g1a", "p2", 0, false, false)
	seedFeedPost(t, h, 3, "g1a", "p3", 0, false, false)
	seedFeedPost(t, h, 10, "g1b", "r on p2", 2, false, false)
	seedFeedPost(t, h, 11, "g1b", "r on p2", 2, false, false)
	seedFeedPost(t, h, 12, "g1b", "r on p3", 3, false, false)

	resp, err := h.svc.GetFeedStats(ctx, connect.NewRequest(&membav1.GetFeedStatsRequest{}))
	if err != nil {
		t.Fatal(err)
	}
	mr := resp.Msg.MostReplied
	if len(mr) < 2 || mr[0].Id != 2 || mr[1].Id != 3 {
		t.Fatalf("most-replied order wrong: got %+v, want p2(id2) then p3(id3)", mr)
	}
	if mr[0].ReplyCount != 2 || mr[1].ReplyCount != 1 {
		t.Fatalf("most-replied counts wrong: %d,%d want 2,1", mr[0].ReplyCount, mr[1].ReplyCount)
	}
}
