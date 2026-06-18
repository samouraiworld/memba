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

	// --- nft_sales + nft_raw_events (via Sale events) ---
	must(t, dispatchEvent(ctx, db, ev("Sale", "gno.land/r/x", 100, 0, 0, map[string]string{
		"via": "buy", "collection": "c", "tokenId": "1", "seller": "s", "buyer": "b", "price": "100",
	}), "H100"))
	must(t, dispatchEvent(ctx, db, ev("Sale", "gno.land/r/x", 200, 0, 0, map[string]string{
		"via": "buy", "collection": "c", "tokenId": "2", "seller": "s", "buyer": "b", "price": "100",
	}), "H200"))

	// --- nft_listings (via NFTListed events) ---
	must(t, dispatchEvent(ctx, db, ev("NFTListed", marketPkg, 100, 0, 0, map[string]string{
		"collection": "c", "tokenId": "10", "seller": "g1s", "price": "500000",
	}), "H100"))
	must(t, dispatchEvent(ctx, db, ev("NFTListed", marketPkg, 200, 0, 0, map[string]string{
		"collection": "c", "tokenId": "11", "seller": "g1s", "price": "600000",
	}), "H200"))

	// --- nft_offers (via OfferMade events) ---
	must(t, dispatchEvent(ctx, db, ev("OfferMade", marketPkg, 100, 0, 0, map[string]string{
		"collection": "c", "tokenId": "20", "buyer": "g1bidder", "amount": "400000",
	}), "H100"))
	must(t, dispatchEvent(ctx, db, ev("OfferMade", marketPkg, 200, 0, 0, map[string]string{
		"collection": "c", "tokenId": "21", "buyer": "g1bidder", "amount": "450000",
	}), "H200"))

	// --- nft_ownership_history: Sale at block 100 already writes a row (kind='buy');
	//     seed an explicit transfer row at block 200 for a distinct survivor check. ---
	must(t, dispatchEvent(ctx, db, ev("MarketTransfer", colPkg, 200, 0, 0, map[string]string{
		"collection": "c", "from": "g1from", "to": "g1to", "tokenId": "30",
	}), "H200"))

	must(t, rollbackFromHeight(ctx, db, 200))

	// nft_sales
	if n := countRows(t, db, `SELECT COUNT(*) FROM nft_sales WHERE event_block >= 200`); n != 0 {
		t.Errorf("sales >= 200 after rollback = %d, want 0", n)
	}
	if n := countRows(t, db, `SELECT COUNT(*) FROM nft_raw_events WHERE event_block >= 200`); n != 0 {
		t.Errorf("raw >= 200 after rollback = %d, want 0", n)
	}
	if n := countRows(t, db, `SELECT COUNT(*) FROM nft_sales WHERE event_block < 200`); n != 1 {
		t.Errorf("sales < 200 = %d, want 1 (kept)", n)
	}

	// nft_listings
	if n := countRows(t, db, `SELECT COUNT(*) FROM nft_listings WHERE event_block >= 200`); n != 0 {
		t.Errorf("listings >= 200 after rollback = %d, want 0", n)
	}
	if n := countRows(t, db, `SELECT COUNT(*) FROM nft_listings WHERE event_block < 200`); n != 1 {
		t.Errorf("listings < 200 = %d, want 1 (kept)", n)
	}

	// nft_offers
	if n := countRows(t, db, `SELECT COUNT(*) FROM nft_offers WHERE event_block >= 200`); n != 0 {
		t.Errorf("offers >= 200 after rollback = %d, want 0", n)
	}
	if n := countRows(t, db, `SELECT COUNT(*) FROM nft_offers WHERE event_block < 200`); n != 1 {
		t.Errorf("offers < 200 = %d, want 1 (kept)", n)
	}

	// nft_ownership_history (column is 'block', not 'event_block')
	if n := countRows(t, db, `SELECT COUNT(*) FROM nft_ownership_history WHERE block >= 200`); n != 0 {
		t.Errorf("ownership_history >= 200 after rollback = %d, want 0", n)
	}
	if n := countRows(t, db, `SELECT COUNT(*) FROM nft_ownership_history WHERE block < 200`); n != 1 {
		t.Errorf("ownership_history < 200 = %d, want 1 (kept, from Sale at block 100)", n)
	}

	// RR-2: collection aggregates must reflect only the surviving sale (block 100,
	// price 100). The rolled-back sale at block 200 must not be counted.
	var totalVol, totalSales int64
	if err := db.QueryRow(`SELECT COALESCE(total_volume_ugnot,0), COALESCE(total_sales,0) FROM nft_collections WHERE collection_id='c'`).Scan(&totalVol, &totalSales); err != nil {
		t.Fatalf("reading collection aggregates: %v", err)
	}
	if totalVol != 100 {
		t.Errorf("total_volume_ugnot after rollback = %d, want 100 (only block-100 sale survives)", totalVol)
	}
	if totalSales != 1 {
		t.Errorf("total_sales after rollback = %d, want 1 (only block-100 sale survives)", totalSales)
	}
}
