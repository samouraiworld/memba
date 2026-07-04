package indexer

import (
	"context"
	"database/sql"
	"testing"
)

const feedPkg = "gno.land/r/samcrew/memba_feed_v1"

// feedEv builds a memba_feed_v1 event with the given attrs at a position.
func feedEv(typ string, block int64, tx, idx int, attrs map[string]string) GnoEvent {
	return ev(typ, feedPkg, block, tx, idx, attrs)
}

// mustDispatch dispatches a feed event and fails the test on a DB error.
func mustDispatch(t *testing.T, db *sql.DB, e GnoEvent) {
	t.Helper()
	if err := dispatchFeedEvent(context.Background(), db, e, "h"); err != nil {
		t.Fatal(err)
	}
}

func TestFeedDispatch_PostCreated(t *testing.T) {
	db := openTestDB(t)
	ctx := context.Background()

	err := dispatchFeedEvent(ctx, db, feedEv("PostCreated", 300, 0, 0, map[string]string{
		"postId": "1", "author": "g1alice", "replyTo": "0", "body": "hello feed",
	}), "hashA")
	if err != nil {
		t.Fatal(err)
	}

	if n := countRows(t, db, `SELECT COUNT(*) FROM feed_posts WHERE post_id=1 AND author='g1alice' AND body='hello feed' AND deleted=0 AND hidden=0`); n != 1 {
		t.Fatalf("post row not projected as expected (got %d)", n)
	}
	// Raw ledger captured it.
	if n := countRows(t, db, `SELECT COUNT(*) FROM feed_raw_events WHERE event_name='PostCreated' AND event_block=300`); n != 1 {
		t.Fatalf("raw event not recorded (got %d)", n)
	}
	// block_h comes from the event block.
	if n := countRows(t, db, `SELECT COUNT(*) FROM feed_posts WHERE post_id=1 AND block_h=300 AND created_event_block=300`); n != 1 {
		t.Fatal("block_h/created_event_block should be the event block")
	}
}

func TestFeedDispatch_Idempotent(t *testing.T) {
	db := openTestDB(t)
	ctx := context.Background()
	e := feedEv("PostCreated", 300, 0, 0, map[string]string{"postId": "1", "author": "g1a", "body": "x"})

	for range 3 {
		if err := dispatchFeedEvent(ctx, db, e, "h"); err != nil {
			t.Fatal(err)
		}
	}
	if n := countRows(t, db, `SELECT COUNT(*) FROM feed_posts WHERE post_id=1`); n != 1 {
		t.Fatalf("re-processing must not duplicate (got %d rows)", n)
	}
}

func TestFeedDispatch_Reply(t *testing.T) {
	db := openTestDB(t)

	mustDispatch(t, db, feedEv("PostCreated", 300, 0, 0, map[string]string{"postId": "1", "author": "g1a", "body": "parent"}))
	mustDispatch(t, db, feedEv("PostCreated", 301, 0, 0, map[string]string{
		"postId": "2", "author": "g1b", "replyTo": "1", "body": "child",
	}))
	if n := countRows(t, db, `SELECT COUNT(*) FROM feed_posts WHERE post_id=2 AND reply_to=1`); n != 1 {
		t.Fatal("reply_to not recorded")
	}
}

func TestFeedDispatch_EditDeleteFlagHideMod(t *testing.T) {
	db := openTestDB(t)
	create := func(id string, block int64) {
		mustDispatch(t, db, feedEv("PostCreated", block, 0, 0, map[string]string{"postId": id, "author": "g1a", "body": "orig"}))
	}

	// Edit updates body + edited_at, but never resurrects a deleted post.
	create("1", 300)
	mustDispatch(t, db, feedEv("PostEdited", 305, 0, 0, map[string]string{"postId": "1", "author": "g1a", "body": "edited"}))
	if n := countRows(t, db, `SELECT COUNT(*) FROM feed_posts WHERE post_id=1 AND body='edited' AND edited_at=305`); n != 1 {
		t.Fatal("edit not applied")
	}

	// Delete tombstones + clears the body.
	mustDispatch(t, db, feedEv("PostDeleted", 306, 0, 0, map[string]string{"postId": "1", "author": "g1a"}))
	if n := countRows(t, db, `SELECT COUNT(*) FROM feed_posts WHERE post_id=1 AND deleted=1 AND body=''`); n != 1 {
		t.Fatal("delete not applied")
	}
	// An edit after delete must NOT resurrect.
	mustDispatch(t, db, feedEv("PostEdited", 307, 0, 0, map[string]string{"postId": "1", "author": "g1a", "body": "zombie"}))
	if n := countRows(t, db, `SELECT COUNT(*) FROM feed_posts WHERE post_id=1 AND body='zombie'`); n != 0 {
		t.Fatal("edit must not resurrect a deleted post")
	}

	// Flag count + auto-hide.
	create("2", 310)
	mustDispatch(t, db, feedEv("PostFlagged", 311, 0, 0, map[string]string{"postId": "2", "flagCount": "3"}))
	if n := countRows(t, db, `SELECT COUNT(*) FROM feed_posts WHERE post_id=2 AND flag_count=3`); n != 1 {
		t.Fatal("flag count not applied")
	}
	mustDispatch(t, db, feedEv("PostAutoHidden", 312, 0, 0, map[string]string{"postId": "2"}))
	if n := countRows(t, db, `SELECT COUNT(*) FROM feed_posts WHERE post_id=2 AND hidden=1`); n != 1 {
		t.Fatal("auto-hide not applied")
	}

	// ModAction remove then unhide.
	create("3", 320)
	mustDispatch(t, db, feedEv("ModAction", 321, 0, 0, map[string]string{"action": "remove", "postId": "3", "moderator": "g1owner"}))
	if n := countRows(t, db, `SELECT COUNT(*) FROM feed_posts WHERE post_id=3 AND deleted=1 AND hidden=1`); n != 1 {
		t.Fatal("mod remove not applied")
	}

	create("4", 330)
	mustDispatch(t, db, feedEv("PostAutoHidden", 331, 0, 0, map[string]string{"postId": "4"}))
	mustDispatch(t, db, feedEv("ModAction", 332, 0, 0, map[string]string{"action": "unhide", "postId": "4", "moderator": "g1owner"}))
	if n := countRows(t, db, `SELECT COUNT(*) FROM feed_posts WHERE post_id=4 AND hidden=0 AND flag_count=0`); n != 1 {
		t.Fatal("mod unhide not applied")
	}
}

func TestFeedDispatch_MalformedSkipped(t *testing.T) {
	db := openTestDB(t)
	ctx := context.Background()

	// Missing postId / author → skipped, no row, but still no error.
	if err := dispatchFeedEvent(ctx, db, feedEv("PostCreated", 300, 0, 0, map[string]string{"author": "g1a"}), "h"); err != nil {
		t.Fatal(err)
	}
	if err := dispatchFeedEvent(ctx, db, feedEv("PostCreated", 300, 0, 1, map[string]string{"postId": "5"}), "h"); err != nil {
		t.Fatal(err)
	}
	if n := countRows(t, db, `SELECT COUNT(*) FROM feed_posts`); n != 0 {
		t.Fatalf("malformed events must not project (got %d)", n)
	}
	// Unknown event type is ignored (raw-logged, no projection, no error).
	if err := dispatchFeedEvent(ctx, db, feedEv("RealmPaused", 300, 0, 2, map[string]string{"by": "g1owner"}), "h"); err != nil {
		t.Fatal(err)
	}
}

func TestFeedRollback_DeletesAtOrAboveHeight(t *testing.T) {
	db := openTestDB(t)
	ctx := context.Background()

	mustDispatch(t, db, feedEv("PostCreated", 300, 0, 0, map[string]string{"postId": "1", "author": "g1a", "body": "keep"}))
	mustDispatch(t, db, feedEv("PostCreated", 305, 0, 0, map[string]string{"postId": "2", "author": "g1a", "body": "drop"}))

	if err := rollbackFeedFromHeight(ctx, db, 305); err != nil {
		t.Fatal(err)
	}
	if n := countRows(t, db, `SELECT COUNT(*) FROM feed_posts WHERE post_id=1`); n != 1 {
		t.Fatal("post below the reorg height must survive")
	}
	if n := countRows(t, db, `SELECT COUNT(*) FROM feed_posts WHERE post_id=2`); n != 0 {
		t.Fatal("post created at/above the reorg height must be deleted")
	}
	if n := countRows(t, db, `SELECT COUNT(*) FROM feed_raw_events WHERE event_block>=305`); n != 0 {
		t.Fatal("raw events at/above the reorg height must be deleted")
	}
}
