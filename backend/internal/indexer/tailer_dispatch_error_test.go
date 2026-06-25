package indexer

import (
	"context"
	"log/slog"
	"testing"
)

// A dispatch failure must NOT advance the cursor past the block. dispatch.go /
// raw_ledger.go assume a projection error is "recoverable by rebuild-from-raw",
// but no RebuildFromRaw exists — so an un-retried event is a permanent silent
// gap. tailOnce must stop at the failed block and reprocess it next cycle;
// idempotent INSERT OR IGNORE makes replaying the already-applied events safe.
func TestTailOnce_DoesNotAdvanceCursorPastFailedDispatch(t *testing.T) {
	db := openTestDB(t)
	ctx := context.Background()

	const pkg = "gno.land/r/samcrew/memba_nft_market_v3"
	watched := map[string]struct{}{pkg: {}}
	saleVolumeSet := map[string]struct{}{}
	cfg := TailerConfig{
		WatchedRealms: []string{pkg},
		StartBlock:    1,
		Confirmations: 0, // process all the way to latest
		Logger:        slog.Default(),
	}

	// Cursor at block 2; block 3 is next. Hashes match the stored cursor so the
	// reorg check passes and we exercise the forward (dispatch) path.
	must(t, saveCursor(ctx, db, []string{pkg}, 2, "H2"))

	// Simulate a transient DB write failure during projection: drop the raw-event
	// table so recordRawEvent (the first step of dispatchEventScoped) errors for
	// block 3's event. The cursor table is untouched — so saveCursor would still
	// succeed, which is exactly the bug: advancing past an un-projected block.
	if _, err := db.ExecContext(ctx, `DROP TABLE nft_raw_events`); err != nil {
		t.Fatal(err)
	}

	src := &fakeBlockSource{
		latest: 3,
		hashes: map[int64]string{2: "H2", 3: "H3"},
		events: map[int64][]GnoEvent{3: {saleEvt(3, validSaleAttrs())}},
	}

	tailOnce(ctx, db, cfg, watched, saleVolumeSet, src)

	got, _, err := loadCursor(ctx, db, []string{pkg}, 1)
	must(t, err)
	if got != 2 {
		t.Fatalf("cursor advanced to %d past a failed dispatch — block 3 would never be reprocessed (want 2)", got)
	}
}
