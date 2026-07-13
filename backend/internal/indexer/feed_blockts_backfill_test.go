package indexer

import (
	"context"
	"log/slog"
	"testing"
)

// errBlockSource is a fakeBlockSource variant whose BlockTime errors for a set
// of heights — to prove a per-height fetch failure doesn't abort the pass.
type errBlockSource struct {
	fakeBlockSource
	times      map[int64]int64
	errHeights map[int64]bool
}

func (e *errBlockSource) BlockTime(_ context.Context, height int64) (int64, error) {
	if e.errHeights[height] {
		return 0, context.DeadlineExceeded
	}
	return e.times[height], nil
}

// TestBackfillMissingBlockTimes fills block_ts=0 rows from the deterministic
// block header time (same source as ingest), leaves already-stamped rows and
// block_h=0 rows untouched, and is idempotent.
func TestBackfillMissingBlockTimes(t *testing.T) {
	db := openTestDB(t)
	ctx := context.Background()

	exec := func(id, blockH, blockTs int64) {
		_, err := db.ExecContext(ctx, `
			INSERT INTO feed_posts
				(post_id, author, body, reply_to, block_h, block_ts, created_event_block, created_at, updated_at)
			VALUES (?, 'g1author', 'hi', 0, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
			id, blockH, blockTs, blockH)
		if err != nil {
			t.Fatalf("insert post %d: %v", id, err)
		}
	}
	// Two pre-migration rows (block_ts=0) at real heights; one already stamped;
	// one with an unknown height (block_h=0) that must stay 0.
	exec(1, 671221, 0)
	exec(2, 775020, 0)
	exec(3, 800000, 999) // already stamped — must not change
	exec(4, 0, 0)        // unknown height — cannot resolve, stays 0

	src := &fakeBlockSource{times: map[int64]int64{
		671221: 1_700_000_100,
		775020: 1_700_000_200,
		800000: 1_700_000_999,
	}}

	backfillMissingBlockTimes(ctx, db, src, slog.Default())

	got := func(id int64) int64 {
		var ts int64
		if err := db.QueryRowContext(ctx, `SELECT block_ts FROM feed_posts WHERE post_id = ?`, id).Scan(&ts); err != nil {
			t.Fatalf("select post %d: %v", id, err)
		}
		return ts
	}
	if got(1) != 1_700_000_100 {
		t.Errorf("post 1 block_ts = %d, want 1700000100", got(1))
	}
	if got(2) != 1_700_000_200 {
		t.Errorf("post 2 block_ts = %d, want 1700000200", got(2))
	}
	if got(3) != 999 {
		t.Errorf("post 3 block_ts = %d, want 999 (already stamped, must not change)", got(3))
	}
	if got(4) != 0 {
		t.Errorf("post 4 block_ts = %d, want 0 (unknown height stays 0)", got(4))
	}

	// Idempotent: a second run makes no further changes (heights 1/2 now stamped,
	// so they are no longer selected).
	backfillMissingBlockTimes(ctx, db, src, slog.Default())
	if got(1) != 1_700_000_100 || got(3) != 999 {
		t.Errorf("second run mutated rows: post1=%d post3=%d", got(1), got(3))
	}
}

// TestBackfillMissingBlockTimes_FetchErrorSkipsOne asserts a per-height fetch
// failure doesn't abort the whole pass — other heights still fill.
func TestBackfillMissingBlockTimes_FetchErrorSkipsOne(t *testing.T) {
	db := openTestDB(t)
	ctx := context.Background()

	for _, h := range []int64{100, 200} {
		_, err := db.ExecContext(ctx, `
			INSERT INTO feed_posts
				(post_id, author, body, reply_to, block_h, block_ts, created_event_block, created_at, updated_at)
			VALUES (?, 'g1a', 'x', 0, ?, 0, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`, h, h, h)
		if err != nil {
			t.Fatal(err)
		}
	}
	// erroring source for height 100, ok for 200.
	src := &errBlockSource{times: map[int64]int64{200: 42}, errHeights: map[int64]bool{100: true}}

	backfillMissingBlockTimes(ctx, db, src, slog.Default())

	var ts100, ts200 int64
	if err := db.QueryRowContext(ctx, `SELECT block_ts FROM feed_posts WHERE post_id = 100`).Scan(&ts100); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRowContext(ctx, `SELECT block_ts FROM feed_posts WHERE post_id = 200`).Scan(&ts200); err != nil {
		t.Fatal(err)
	}
	if ts100 != 0 {
		t.Errorf("height 100 errored, block_ts should stay 0, got %d", ts100)
	}
	if ts200 != 42 {
		t.Errorf("height 200 should fill to 42, got %d", ts200)
	}
}
