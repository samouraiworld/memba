package indexer

import (
	"context"
	"testing"
)

// F13 — v3 AcceptOffer emits ONLY Sale(via="offer") (no separate OfferAccepted
// event). The Sale settles correctly, but nothing marked the accepted offer
// resolved, so its nft_offers row lingered as status='active' forever (a phantom
// offer on an already-sold token). applySale must resolve the buyer's active
// offer as 'accepted' when via="offer".

const v3market = "gno.land/r/samcrew/memba_nft_market_v3"

func TestApplySale_ViaOffer_ResolvesActiveOffer(t *testing.T) {
	db := openTestDB(t)
	ctx := context.Background()
	// an active offer exists
	must(t, dispatchEvent(ctx, db, ev("OfferMade", v3market, 100, 0, 0, map[string]string{
		"collection": "g1c/art", "tokenId": "0", "buyer": "g1b", "amount": "800000",
	}), ""))
	// the seller accepts it → v3 emits ONLY Sale(via="offer")
	must(t, dispatchEvent(ctx, db, ev("Sale", v3market, 101, 0, 0, map[string]string{
		"via": "offer", "collection": "g1c/art", "tokenId": "0",
		"seller": "g1s", "buyer": "g1b", "price": "800000", "fee": "16000", "royalty": "40000",
	}), ""))
	var status string
	if err := db.QueryRow(`SELECT status FROM nft_offers WHERE collection_id='g1c/art' AND token_id='0' AND buyer='g1b'`).Scan(&status); err != nil {
		t.Fatalf("offer row missing: %v", err)
	}
	if status != "accepted" {
		t.Fatalf("offer status=%q want accepted (Sale via=offer must resolve the offer)", status)
	}
}

func TestApplySale_ViaBuy_LeavesOffersUntouched(t *testing.T) {
	db := openTestDB(t)
	ctx := context.Background()
	must(t, dispatchEvent(ctx, db, ev("OfferMade", v3market, 100, 0, 0, map[string]string{
		"collection": "g1c/art", "tokenId": "0", "buyer": "g1b", "amount": "800000",
	}), ""))
	// an unrelated fixed-price buy of a different token
	must(t, dispatchEvent(ctx, db, ev("Sale", v3market, 101, 0, 0, map[string]string{
		"via": "buy", "collection": "g1c/art", "tokenId": "1",
		"seller": "g1s", "buyer": "g1x", "price": "1000000", "fee": "20000", "royalty": "50000",
	}), ""))
	var status string
	if err := db.QueryRow(`SELECT status FROM nft_offers WHERE collection_id='g1c/art' AND token_id='0' AND buyer='g1b'`).Scan(&status); err != nil {
		t.Fatalf("offer row missing: %v", err)
	}
	if status != "active" {
		t.Fatalf("unrelated offer status=%q want active (a buy must not touch offers)", status)
	}
}
