package indexer

import (
	"context"
	"testing"
)

func TestConfirmedEnd(t *testing.T) {
	// latest=1000, confirmations=5 → safe tip = 995.
	if got := confirmedEnd(1000, 5, 100, 500); got != 600 {
		t.Errorf("cursor-bound: got %d, want 600 (cursor+max)", got)
	}
	if got := confirmedEnd(1000, 5, 994, 500); got != 995 {
		t.Errorf("safe-tip-bound: got %d, want 995 (latest-confirmations)", got)
	}
	if got := confirmedEnd(1000, 5, 995, 500); got != 995 {
		t.Errorf("caught-up: got %d, want 995 (no work)", got)
	}
	if got := confirmedEnd(3, 5, 0, 500); got != 0 {
		t.Errorf("not-enough-confirmations: got %d, want 0", got)
	}
}

func TestRollbackFromHeight(t *testing.T) {
	db := openTestDB(t)
	ctx := context.Background()
	must(t, dispatchEvent(ctx, db, ev("Sale", "gno.land/r/x", 100, 0, 0, map[string]string{
		"via": "buy", "collection": "c", "tokenId": "1", "seller": "s", "buyer": "b", "price": "100",
	}), "H100"))
	must(t, dispatchEvent(ctx, db, ev("Sale", "gno.land/r/x", 200, 0, 0, map[string]string{
		"via": "buy", "collection": "c", "tokenId": "2", "seller": "s", "buyer": "b", "price": "100",
	}), "H200"))

	must(t, rollbackFromHeight(ctx, db, 200))

	if n := countRows(t, db, `SELECT COUNT(*) FROM nft_sales WHERE event_block >= 200`); n != 0 {
		t.Errorf("sales >= 200 after rollback = %d, want 0", n)
	}
	if n := countRows(t, db, `SELECT COUNT(*) FROM nft_raw_events WHERE event_block >= 200`); n != 0 {
		t.Errorf("raw >= 200 after rollback = %d, want 0", n)
	}
	if n := countRows(t, db, `SELECT COUNT(*) FROM nft_sales WHERE event_block < 200`); n != 1 {
		t.Errorf("sales < 200 = %d, want 1 (kept)", n)
	}
}
