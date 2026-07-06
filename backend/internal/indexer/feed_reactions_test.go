package indexer

import (
	"testing"
)

func TestFeedDispatch_Reactions(t *testing.T) {
	db := openTestDB(t)

	mustDispatch(t, db, feedEv("PostCreated", 300, 0, 0, map[string]string{"postId": "1", "author": "g1a", "body": "react"}))

	// Two wallets 👍, one also ❤️.
	mustDispatch(t, db, feedEv("ReactionAdded", 301, 0, 0, map[string]string{"postId": "1", "emoji": "👍", "by": "g1bob"}))
	mustDispatch(t, db, feedEv("ReactionAdded", 302, 0, 0, map[string]string{"postId": "1", "emoji": "👍", "by": "g1carol"}))
	mustDispatch(t, db, feedEv("ReactionAdded", 303, 0, 0, map[string]string{"postId": "1", "emoji": "❤️", "by": "g1bob"}))

	if n := countRows(t, db, `SELECT COUNT(*) FROM feed_reactions WHERE post_id=1 AND emoji='👍'`); n != 2 {
		t.Fatalf("👍 rows = %d, want 2", n)
	}
	if n := countRows(t, db, `SELECT COUNT(*) FROM feed_reactions WHERE post_id=1 AND emoji='❤️'`); n != 1 {
		t.Fatalf("❤️ rows = %d, want 1", n)
	}

	// Re-processing a ReactionAdded is idempotent (INSERT OR IGNORE on the key).
	mustDispatch(t, db, feedEv("ReactionAdded", 301, 0, 0, map[string]string{"postId": "1", "emoji": "👍", "by": "g1bob"}))
	if n := countRows(t, db, `SELECT COUNT(*) FROM feed_reactions WHERE post_id=1 AND emoji='👍' AND reactor='g1bob'`); n != 1 {
		t.Fatal("duplicate ReactionAdded must not double-insert")
	}

	// ReactionRemoved deletes exactly bob's 👍; carol's remains.
	mustDispatch(t, db, feedEv("ReactionRemoved", 304, 0, 0, map[string]string{"postId": "1", "emoji": "👍", "by": "g1bob"}))
	if n := countRows(t, db, `SELECT COUNT(*) FROM feed_reactions WHERE post_id=1 AND emoji='👍'`); n != 1 {
		t.Fatalf("after remove, 👍 rows = %d, want 1", n)
	}
	if n := countRows(t, db, `SELECT COUNT(*) FROM feed_reactions WHERE post_id=1 AND reactor='g1carol'`); n != 1 {
		t.Fatal("carol's 👍 should remain")
	}

	// Malformed events (missing emoji / by) are skipped, not errors.
	mustDispatch(t, db, feedEv("ReactionAdded", 305, 0, 0, map[string]string{"postId": "1", "by": "g1x"}))
	if n := countRows(t, db, `SELECT COUNT(*) FROM feed_reactions WHERE reactor='g1x'`); n != 0 {
		t.Fatal("malformed reaction (no emoji) must be skipped")
	}

	// Raw ledger captured the reaction events (rebuildable projection).
	if n := countRows(t, db, `SELECT COUNT(*) FROM feed_raw_events WHERE event_name='ReactionAdded'`); n < 3 {
		t.Fatalf("raw ReactionAdded events not recorded (got %d)", n)
	}
}
