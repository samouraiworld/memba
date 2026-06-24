package indexer

import (
	"context"
	"testing"
)

// F12 — realm↔indexer event-contract mismatch for the v3 launchpad.
// The v3 registry realm (memba_collections) emits DIFFERENT attribute/event
// names than the v2-era indexer (and its tests) assumed:
//   - "collectionID"  (v3)  vs  "collection"     (v2 / indexer)
//   - "minter"        (v3)  vs  "to"             (Mint recipient)
//   - event "RoyaltySet" + attr "bps"  vs  "RoyaltyChanged" + "royaltyBPS"
// So CollectionCreated / Mint / MarketTransfer / Royalty events silently
// indexed under empty IDs / owners — the whole launchpad pipeline. These tests
// use the REAL v3 names the realm emits.

const collsPkg = "gno.land/r/samcrew/memba_collections"

func TestApplyMint_V3_CollectionIDAndMinter(t *testing.T) {
	db := openTestDB(t)
	must(t, dispatchEvent(context.Background(), db, ev("Mint", collsPkg, 50, 0, 0, map[string]string{
		"collectionID": "g1creator/art", "tokenId": "0", "minter": "g1owner",
	}), ""))
	var owner string
	if err := db.QueryRow(`SELECT owner FROM nft_tokens WHERE collection_id='g1creator/art' AND token_id='0'`).Scan(&owner); err != nil {
		t.Fatalf("v3 Mint not indexed under collectionID: %v", err)
	}
	if owner != "g1owner" {
		t.Fatalf("owner=%q want g1owner (Mint recipient comes from \"minter\")", owner)
	}
}

func TestApplyMarketTransfer_V3_CollectionID(t *testing.T) {
	db := openTestDB(t)
	must(t, dispatchEvent(context.Background(), db, ev("MarketTransfer", collsPkg, 60, 0, 0, map[string]string{
		"collectionID": "g1creator/art", "tokenId": "0", "from": "g1a", "to": "g1b",
	}), ""))
	if n := countRows(t, db, `SELECT COUNT(*) FROM nft_tokens WHERE collection_id='g1creator/art' AND token_id='0' AND owner='g1b'`); n != 1 {
		t.Fatalf("v3 MarketTransfer not indexed under collectionID: rows=%d want 1", n)
	}
}

func TestApplyCollectionCreated_V3_CollectionID(t *testing.T) {
	db := openTestDB(t)
	must(t, dispatchEvent(context.Background(), db, ev("CollectionCreated", collsPkg, 10, 0, 0, map[string]string{
		"collectionID": "g1creator/art", "name": "Art", "symbol": "ART", "creator": "g1creator", "royaltyBPS": "500",
	}), ""))
	if n := countRows(t, db, `SELECT COUNT(*) FROM nft_collections WHERE collection_id='g1creator/art' AND name='Art'`); n != 1 {
		t.Fatalf("v3 CollectionCreated not indexed under collectionID: rows=%d want 1", n)
	}
}

func TestApplyRoyaltySet_V3_EventNameAndBps(t *testing.T) {
	db := openTestDB(t)
	// the realm emits the event "RoyaltySet" with attrs "collectionID" + "bps"
	must(t, dispatchEvent(context.Background(), db, ev("RoyaltySet", collsPkg, 70, 0, 0, map[string]string{
		"collectionID": "g1creator/art", "bps": "750", "recip": "g1royal",
	}), ""))
	var bps int64
	if err := db.QueryRow(`SELECT royalty_bps FROM nft_collections WHERE collection_id='g1creator/art'`).Scan(&bps); err != nil {
		t.Fatalf("v3 RoyaltySet not indexed (event name/attrs mismatch): %v", err)
	}
	if bps != 750 {
		t.Fatalf("royalty_bps=%d want 750", bps)
	}
}

// Regression guard: the v2 form ("collection" / "to") must keep working.
func TestApplyMint_V2_LegacyNamesStillWork(t *testing.T) {
	db := openTestDB(t)
	must(t, dispatchEvent(context.Background(), db, ev("Mint", colPkg, 50, 0, 0, map[string]string{
		"collection": "genesis", "tokenId": "9", "to": "g1legacy",
	}), ""))
	var owner string
	if err := db.QueryRow(`SELECT owner FROM nft_tokens WHERE collection_id='genesis' AND token_id='9'`).Scan(&owner); err != nil {
		t.Fatalf("v2 Mint regressed: %v", err)
	}
	if owner != "g1legacy" {
		t.Fatalf("owner=%q want g1legacy", owner)
	}
}
