package indexer

import (
	"context"
	"database/sql"
	"encoding/json"
	"log/slog"
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
	if err := dispatchFeedEvent(context.Background(), db, e, "h", 0); err != nil {
		t.Fatal(err)
	}
}

func TestFeedDispatch_PostCreated(t *testing.T) {
	db := openTestDB(t)
	ctx := context.Background()

	err := dispatchFeedEvent(ctx, db, feedEv("PostCreated", 300, 0, 0, map[string]string{
		"postId": "1", "author": "g1alice", "replyTo": "0", "body": "hello feed",
	}), "hashA", 1700000000)
	if err != nil {
		t.Fatal(err)
	}

	// block_ts is the deterministic block header time passed by the tailer.
	if n := countRows(t, db, `SELECT COUNT(*) FROM feed_posts WHERE post_id=1 AND block_ts=1700000000`); n != 1 {
		t.Fatal("block_ts should be persisted from the block header time")
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
		if err := dispatchFeedEvent(ctx, db, e, "h", 0); err != nil {
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

// C.1: the flagger address in PostFlagged is projected into feed_flags (the
// dispatcher used to keep only the aggregate flag_count).
func TestFeedDispatch_ProjectsFlagger(t *testing.T) {
	db := openTestDB(t)
	mustDispatch(t, db, feedEv("PostCreated", 300, 0, 0, map[string]string{"postId": "1", "author": "g1a", "body": "x"}))
	mustDispatch(t, db, feedEv("PostFlagged", 311, 0, 0, map[string]string{"postId": "1", "flagger": "g1bob", "flagCount": "1"}))

	if n := countRows(t, db, `SELECT COUNT(*) FROM feed_flags WHERE post_id=1 AND flagger_addr='g1bob' AND event_block=311`); n != 1 {
		t.Fatalf("flagger not projected into feed_flags (got %d)", n)
	}
	// The aggregate count is still maintained on the post row.
	if n := countRows(t, db, `SELECT COUNT(*) FROM feed_posts WHERE post_id=1 AND flag_count=1`); n != 1 {
		t.Fatal("flag_count regressed")
	}
	// Re-dispatching the same flag is idempotent (one flagger row).
	mustDispatch(t, db, feedEv("PostFlagged", 311, 0, 0, map[string]string{"postId": "1", "flagger": "g1bob", "flagCount": "1"}))
	if n := countRows(t, db, `SELECT COUNT(*) FROM feed_flags WHERE post_id=1`); n != 1 {
		t.Fatalf("re-projecting must not duplicate the flag (got %d)", n)
	}
	// A flagger-less PostFlagged (malformed) still updates the count but adds no row.
	mustDispatch(t, db, feedEv("PostFlagged", 312, 0, 0, map[string]string{"postId": "1", "flagCount": "2"}))
	if n := countRows(t, db, `SELECT COUNT(*) FROM feed_flags WHERE post_id=1`); n != 1 {
		t.Fatalf("a flagger-less event must not add a flag row (got %d)", n)
	}
}

// C.1: a reorg drops projected flags at/above the reorged height, like posts.
func TestFeedRollback_DeletesFeedFlags(t *testing.T) {
	db := openTestDB(t)
	mustDispatch(t, db, feedEv("PostCreated", 300, 0, 0, map[string]string{"postId": "1", "author": "g1a", "body": "x"}))
	mustDispatch(t, db, feedEv("PostFlagged", 300, 0, 1, map[string]string{"postId": "1", "flagger": "g1old", "flagCount": "1"}))
	mustDispatch(t, db, feedEv("PostFlagged", 305, 0, 0, map[string]string{"postId": "1", "flagger": "g1new", "flagCount": "2"}))

	if err := rollbackFeedFromHeight(context.Background(), db, 305); err != nil {
		t.Fatal(err)
	}
	if n := countRows(t, db, `SELECT COUNT(*) FROM feed_flags WHERE flagger_addr='g1new'`); n != 0 {
		t.Fatal("a flag at/above the reorg height must be deleted")
	}
	if n := countRows(t, db, `SELECT COUNT(*) FROM feed_flags WHERE flagger_addr='g1old'`); n != 1 {
		t.Fatal("a flag below the reorg height must survive")
	}
}

// C.1: historical flags (raw events that predate the projection) backfill from
// feed_raw_events, idempotently, with no RPC (the flagger is in attrs_json).
func TestBackfillFeedFlags_FromRaw(t *testing.T) {
	db := openTestDB(t)
	ctx := context.Background()
	seedRaw := func(block int64, idx int, attrs map[string]string) {
		b, _ := json.Marshal(attrs)
		if _, err := db.ExecContext(ctx, `
			INSERT INTO feed_raw_events (event_block, event_tx_index, event_index, pkg_path, event_name, attrs_json, block_hash, ingest_ts)
			VALUES (?, 0, ?, ?, 'PostFlagged', ?, 'h', CURRENT_TIMESTAMP)`,
			block, idx, feedPkg, string(b)); err != nil {
			t.Fatal(err)
		}
	}
	seedRaw(400, 0, map[string]string{"postId": "7", "flagger": "g1x", "flagCount": "1"})
	seedRaw(401, 0, map[string]string{"postId": "7", "flagger": "g1y", "flagCount": "2"}) // same post, 2nd flagger
	seedRaw(402, 0, map[string]string{"postId": "8", "flagger": "g1x", "flagCount": "1"}) // same flagger, other post
	seedRaw(403, 0, map[string]string{"postId": "9", "flagCount": "1"})                   // malformed (no flagger) → skipped

	backfillFeedFlags(ctx, db, slog.Default())

	if n := countRows(t, db, `SELECT COUNT(*) FROM feed_flags`); n != 3 {
		t.Fatalf("backfill should project 3 well-formed flags (got %d)", n)
	}
	if n := countRows(t, db, `SELECT COUNT(*) FROM feed_flags WHERE post_id=7 AND event_block=401 AND flagger_addr='g1y'`); n != 1 {
		t.Fatal("a backfilled flag should carry its raw event_block + flagger")
	}
	// Second pass adds nothing (idempotent).
	backfillFeedFlags(ctx, db, slog.Default())
	if n := countRows(t, db, `SELECT COUNT(*) FROM feed_flags`); n != 3 {
		t.Fatalf("backfill must be idempotent (got %d)", n)
	}
}

// C′.3: a reorg drops projected reactions at/above the reorged height too (the
// rollback had an index for it but never issued the DELETE — latent until
// reactions go live on v2, but a v2-cutover / rebuild correctness dependency).
func TestFeedRollback_DeletesFeedReactions(t *testing.T) {
	db := openTestDB(t)
	mustDispatch(t, db, feedEv("PostCreated", 300, 0, 0, map[string]string{"postId": "1", "author": "g1a", "body": "x"}))
	mustDispatch(t, db, feedEv("ReactionAdded", 300, 0, 1, map[string]string{"postId": "1", "emoji": "👍", "by": "g1old"}))
	mustDispatch(t, db, feedEv("ReactionAdded", 305, 0, 0, map[string]string{"postId": "1", "emoji": "🔥", "by": "g1new"}))

	if err := rollbackFeedFromHeight(context.Background(), db, 305); err != nil {
		t.Fatal(err)
	}
	if n := countRows(t, db, `SELECT COUNT(*) FROM feed_reactions WHERE reactor='g1new'`); n != 0 {
		t.Fatal("a reaction at/above the reorg height must be deleted")
	}
	if n := countRows(t, db, `SELECT COUNT(*) FROM feed_reactions WHERE reactor='g1old'`); n != 1 {
		t.Fatal("a reaction below the reorg height must survive")
	}
}

// C.2: a serving override is out-of-band operator state (sibling of
// feed_blocklist), NOT derived from chain events — a reorg must NEVER delete it,
// or a routine single-block reorg would silently wipe operator restore decisions.
func TestFeedRollback_PreservesServingOverrides(t *testing.T) {
	db := openTestDB(t)
	mustDispatch(t, db, feedEv("PostCreated", 300, 0, 0, map[string]string{"postId": "1", "author": "g1a", "body": "x"}))
	mustDispatch(t, db, feedEv("PostFlagged", 305, 0, 0, map[string]string{"postId": "1", "flagger": "g1n", "flagCount": "2"}))
	if _, err := db.Exec(`INSERT INTO feed_serving_overrides (post_id, reason, added_by) VALUES (1, 'restore', 'ops')`); err != nil {
		t.Fatal(err)
	}

	if err := rollbackFeedFromHeight(context.Background(), db, 305); err != nil {
		t.Fatal(err)
	}
	// The flag at 305 is rolled back (proving the reorg ran); the override survives.
	if n := countRows(t, db, `SELECT COUNT(*) FROM feed_flags WHERE flagger_addr='g1n'`); n != 0 {
		t.Fatal("the flag at the reorg height should have been rolled back")
	}
	if n := countRows(t, db, `SELECT COUNT(*) FROM feed_serving_overrides WHERE post_id=1`); n != 1 {
		t.Fatal("a serving override (out-of-band operator state) must survive a reorg")
	}
}

func TestFeedDispatch_MalformedSkipped(t *testing.T) {
	db := openTestDB(t)
	ctx := context.Background()

	// Missing postId / author → skipped, no row, but still no error.
	if err := dispatchFeedEvent(ctx, db, feedEv("PostCreated", 300, 0, 0, map[string]string{"author": "g1a"}), "h", 0); err != nil {
		t.Fatal(err)
	}
	if err := dispatchFeedEvent(ctx, db, feedEv("PostCreated", 300, 0, 1, map[string]string{"postId": "5"}), "h", 0); err != nil {
		t.Fatal(err)
	}
	if n := countRows(t, db, `SELECT COUNT(*) FROM feed_posts`); n != 0 {
		t.Fatalf("malformed events must not project (got %d)", n)
	}
	// Unknown event type is ignored (raw-logged, no projection, no error).
	if err := dispatchFeedEvent(ctx, db, feedEv("RealmPaused", 300, 0, 2, map[string]string{"by": "g1owner"}), "h", 0); err != nil {
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
