package indexer

import (
	"context"
	"log/slog"
	"testing"
)

// fakeBlockSource is an in-memory blockSource for testing tailOnce without
// hitting a real RPC node. Fields are mutable so a test can reorg the chain
// between tailOnce calls.
type fakeBlockSource struct {
	latest int64
	hashes map[int64]string
	events map[int64][]GnoEvent
	times  map[int64]int64 // optional block header times (unix s); nil → 0
}

func (f *fakeBlockSource) LatestHeight(_ context.Context) (int64, error) {
	return f.latest, nil
}

func (f *fakeBlockSource) BlockTime(_ context.Context, height int64) (int64, error) {
	return f.times[height], nil
}

func (f *fakeBlockSource) BlockHash(_ context.Context, height int64) (string, error) {
	return f.hashes[height], nil
}

func (f *fakeBlockSource) BlockEvents(_ context.Context, height int64) ([]GnoEvent, error) {
	return f.events[height], nil
}

// TestTailOnce_TipReorg_RollsBackAndReplays exercises the reorg-detection
// branch in tailOnce end-to-end:
//
//  1. Chain v1: latest=3, block 3 has a Sale with tokenId="OLD" → tailOnce
//     processes blocks 1-3; asserts OLD present, cursor at 3.
//  2. Chain reorgs at the tip: hash[3] changes, block 3 now has tokenId="NEW" →
//     tailOnce detects mismatch at cursor 3, rolls back, re-processes block 3;
//     asserts OLD absent, NEW present, raw ledger for block 3 only has NEW.
//
// Confirmations=0 so confirmedEnd processes all the way to latest (the test is
// about the reorg loop, not confirmation depth).
//
// Single-block recovery depth: this test documents the SUPPORTED case (tip
// reorg). See the comment at the reorg-detection site in tailOnce for the
// documented limitation: only the cursor block's hash is re-validated, so a
// reorg that changed a non-tip block's events (below the cursor) would not be
// caught. The Confirmations depth (default 5) makes such a scenario implausibly
// deep on gno.land's consensus.
func TestTailOnce_TipReorg_RollsBackAndReplays(t *testing.T) {
	db := openTestDB(t)
	ctx := context.Background()

	const pkg = "gno.land/r/samcrew/memba_nft_market_v3"
	watched := map[string]struct{}{pkg: {}}
	saleVolumeSet := map[string]struct{}{} // empty → Sale always writes volume

	cfg := TailerConfig{
		WatchedRealms: []string{pkg},
		StartBlock:    1,
		Confirmations: 0, // process all the way to latest
		Logger:        slog.Default(),
	}

	saleAttrs := func(tokenID, price string) map[string]string {
		return map[string]string{
			"via": "buy", "collection": "c", "tokenId": tokenID,
			"seller": "g1s", "buyer": "g1b",
			"price": price, "fee": "0", "royalty": "0",
		}
	}

	// ── Chain v1: blocks 1-3, block 3 has a Sale with tokenId="OLD" ────────────
	src := &fakeBlockSource{
		latest: 3,
		hashes: map[int64]string{1: "a1", 2: "a2", 3: "a3"},
		events: map[int64][]GnoEvent{
			3: {ev("Sale", pkg, 3, 0, 0, saleAttrs("OLD", "100"))},
		},
	}

	// First tailOnce: process blocks 1-3 on chain v1.
	tailOnce(ctx, db, cfg, watched, saleVolumeSet, src)

	if n := countRows(t, db, `SELECT COUNT(*) FROM nft_sales WHERE token_id='OLD'`); n != 1 {
		t.Fatalf("after v1: nft_sales OLD = %d, want 1", n)
	}
	cursor, _, err := loadCursor(ctx, db, cfg.WatchedRealms, cfg.StartBlock)
	if err != nil {
		t.Fatal(err)
	}
	if cursor != 3 {
		t.Fatalf("after v1: cursor = %d, want 3", cursor)
	}

	// ── Reorg the tip: block 3 gets a new hash and new event ────────────────────
	src.hashes[3] = "b3" // hash mismatch → triggers reorg detection
	src.events[3] = []GnoEvent{ev("Sale", pkg, 3, 0, 0, saleAttrs("NEW", "200"))}

	// Second tailOnce: detect mismatch at cursor 3, rollback, replay block 3 with NEW.
	tailOnce(ctx, db, cfg, watched, saleVolumeSet, src)

	// OLD must be gone (rolled back).
	if n := countRows(t, db, `SELECT COUNT(*) FROM nft_sales WHERE token_id='OLD'`); n != 0 {
		t.Errorf("after reorg: nft_sales OLD = %d, want 0 (should be rolled back)", n)
	}
	// NEW must be present.
	if n := countRows(t, db, `SELECT COUNT(*) FROM nft_sales WHERE token_id='NEW'`); n != 1 {
		t.Errorf("after reorg: nft_sales NEW = %d, want 1", n)
	}
	// Raw ledger at block 3 must reflect only the NEW event (OLD removed).
	if n := countRows(t, db, `SELECT COUNT(*) FROM nft_raw_events WHERE event_block=3`); n != 1 {
		t.Errorf("after reorg: nft_raw_events at block 3 = %d, want 1 (only NEW)", n)
	}
	var evName string
	if err := db.QueryRow(`SELECT event_name FROM nft_raw_events WHERE event_block=3`).Scan(&evName); err != nil {
		t.Fatal(err)
	}
	if evName != "Sale" {
		t.Errorf("raw event name = %q, want Sale", evName)
	}
	// Block hash stored for block 3 must be the new hash.
	_, storedHash, err := loadCursor(ctx, db, cfg.WatchedRealms, cfg.StartBlock)
	if err != nil {
		t.Fatal(err)
	}
	if storedHash != "b3" {
		t.Errorf("stored hash after reorg = %q, want b3", storedHash)
	}

	// RR-2: collection aggregates must reflect ONLY the NEW sale (price 200),
	// not OLD+NEW stacked — proving no inflation from reorg rollback+replay.
	var totalVol, totalSales int64
	if err := db.QueryRow(`SELECT COALESCE(total_volume_ugnot,0), COALESCE(total_sales,0) FROM nft_collections WHERE collection_id='c'`).Scan(&totalVol, &totalSales); err != nil {
		t.Fatalf("reading collection aggregates after reorg: %v", err)
	}
	if totalVol != 200 {
		t.Errorf("total_volume_ugnot after reorg = %d, want 200 (only NEW sale)", totalVol)
	}
	if totalSales != 1 {
		t.Errorf("total_sales after reorg = %d, want 1 (only NEW sale, no inflation)", totalSales)
	}
}
