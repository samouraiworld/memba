package indexer

import (
	"context"
	"database/sql"
	"testing"
)

// WS-B / audit F2: the v3 Sale event is the canonical volume row. A malformed
// Sale (unknown/missing `via`, or missing/garbled numeric amounts) must be
// REJECTED, not silently written with a bad kind or zeroed amounts — otherwise
// schema drift corrupts volume/floor/points without any signal.

const v3saleVal = "gno.land/r/samcrew/memba_nft_market_v3"

func saleEvt(block int64, attrs map[string]string) GnoEvent {
	return ev("Sale", v3saleVal, block, 0, 0, attrs)
}

func validSaleAttrs() map[string]string {
	return map[string]string{
		"via": "buy", "collection": "genesis", "tokenId": "1",
		"seller": "g1seller", "buyer": "g1buyer",
		"price": "1000000", "fee": "20000", "royalty": "50000", "denom": "ugnot",
	}
}

func nftSaleCount(t *testing.T, db *sql.DB) int {
	t.Helper()
	return countRows(t, db, `SELECT COUNT(*) FROM nft_sales`)
}

func TestApplySale_ValidVia_Written(t *testing.T) {
	db := openTestDB(t)
	must(t, dispatchEvent(context.Background(), db, saleEvt(700, validSaleAttrs()), ""))
	if got := nftSaleCount(t, db); got != 1 {
		t.Fatalf("valid sale should be written: rows=%d want 1", got)
	}
}

func TestApplySale_ZeroRoyalty_Written(t *testing.T) {
	db := openTestDB(t)
	a := validSaleAttrs()
	a["royalty"] = "0" // a legit zero-royalty sale: "0" is valid, not "missing"
	must(t, dispatchEvent(context.Background(), db, saleEvt(701, a), ""))
	if got := nftSaleCount(t, db); got != 1 {
		t.Fatalf("zero-royalty sale must still be written: rows=%d want 1", got)
	}
}

func TestApplySale_UnknownVia_Skipped(t *testing.T) {
	db := openTestDB(t)
	a := validSaleAttrs()
	a["via"] = "bogus"
	must(t, dispatchEvent(context.Background(), db, saleEvt(702, a), ""))
	if got := nftSaleCount(t, db); got != 0 {
		t.Fatalf("unknown via must be skipped: rows=%d want 0", got)
	}
}

func TestApplySale_EmptyVia_Skipped(t *testing.T) {
	db := openTestDB(t)
	a := validSaleAttrs()
	a["via"] = ""
	must(t, dispatchEvent(context.Background(), db, saleEvt(703, a), ""))
	if got := nftSaleCount(t, db); got != 0 {
		t.Fatalf("empty via must be skipped: rows=%d want 0", got)
	}
}

func TestApplySale_NonNumericPrice_Skipped(t *testing.T) {
	db := openTestDB(t)
	a := validSaleAttrs()
	a["price"] = "notanumber"
	must(t, dispatchEvent(context.Background(), db, saleEvt(704, a), ""))
	if got := nftSaleCount(t, db); got != 0 {
		t.Fatalf("non-numeric price must be skipped (not written as 0): rows=%d want 0", got)
	}
}

func TestApplySale_MissingFee_Skipped(t *testing.T) {
	db := openTestDB(t)
	a := validSaleAttrs()
	delete(a, "fee") // attr absent entirely
	must(t, dispatchEvent(context.Background(), db, saleEvt(705, a), ""))
	if got := nftSaleCount(t, db); got != 0 {
		t.Fatalf("missing fee must be skipped: rows=%d want 0", got)
	}
}

func TestApplySale_MissingBuyer_Skipped(t *testing.T) {
	db := openTestDB(t)
	a := validSaleAttrs()
	delete(a, "buyer")
	must(t, dispatchEvent(context.Background(), db, saleEvt(706, a), ""))
	if got := nftSaleCount(t, db); got != 0 {
		t.Fatalf("missing buyer must be skipped: rows=%d want 0", got)
	}
}
