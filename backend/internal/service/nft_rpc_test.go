package service

import (
	"context"
	"testing"

	"connectrpc.com/connect"
	membav1 "github.com/samouraiworld/memba/backend/gen/memba/v1"
)

// seedNFT inserts cached NFT rows directly for handler tests.
func seedNFTCollection(t *testing.T, h *testHarness) {
	t.Helper()
	_, err := h.db.Exec(`
		INSERT INTO nft_collections
			(collection_id, realm, name, symbol, supply, royalty_bps,
			 total_volume_ugnot, total_sales, active_listings, floor_price_ugnot, updated_at)
		VALUES ('genesis', 'gno.land/r/samcrew/memba_nft_v2', 'Memba Genesis', 'MGEN', 3, 500,
		        1500000, 5, 2, 500000, CURRENT_TIMESTAMP)`)
	if err != nil {
		t.Fatal("seed collection:", err)
	}
	_, err = h.db.Exec(`
		INSERT INTO nft_tokens (collection_id, token_id, owner, uri, listed, price_ugnot, updated_at) VALUES
			('genesis', '1', 'g1alice', 'ipfs://x/1', 0, NULL, CURRENT_TIMESTAMP),
			('genesis', '2', 'g1bob',   'ipfs://x/2', 1, 500000, CURRENT_TIMESTAMP),
			('genesis', '3', 'g1alice', 'ipfs://x/3', 0, NULL, CURRENT_TIMESTAMP)`)
	if err != nil {
		t.Fatal("seed tokens:", err)
	}
	// Event-sourced sales (full untruncated addresses). Higher event position =
	// newer; the handler orders by (event_block, event_tx_index, event_index) DESC.
	_, err = h.db.Exec(`
		INSERT INTO nft_sales
			(collection_id, token_id, seller, buyer, price_ugnot, fee_ugnot, royalty_ugnot,
			 sale_block, kind, event_block, event_tx_index, event_index) VALUES
			('genesis', '1', 'g1seller1', 'g1buyer1', 500000,  12500, 25000, 100, 'sale', 100, 0, 0),
			('genesis', '3', 'g1seller2', 'g1buyer2', 1250000, 31250, 62500, 200, 'sale', 200, 0, 0)`)
	if err != nil {
		t.Fatal("seed sales:", err)
	}
}

func TestGetNFTCollection(t *testing.T) {
	h := setup(t)
	seedNFTCollection(t, h)
	ctx := context.Background()

	resp, err := h.svc.GetNFTCollection(ctx, connect.NewRequest(&membav1.GetNFTCollectionRequest{
		CollectionId: "genesis",
	}))
	if err != nil {
		t.Fatal("GetNFTCollection:", err)
	}
	m := resp.Msg
	if m.Name != "Memba Genesis" || m.Symbol != "MGEN" {
		t.Errorf("name/symbol = %q/%q", m.Name, m.Symbol)
	}
	if m.Supply != 3 || m.RoyaltyBps != 500 {
		t.Errorf("supply/royalty = %d/%d", m.Supply, m.RoyaltyBps)
	}
	if m.FloorPriceUgnot != 500000 || m.TotalVolumeUgnot != 1500000 {
		t.Errorf("floor/volume = %d/%d", m.FloorPriceUgnot, m.TotalVolumeUgnot)
	}
	if m.TotalSales != 5 || m.ActiveListings != 2 {
		t.Errorf("sales/listings = %d/%d", m.TotalSales, m.ActiveListings)
	}
}

func TestGetNFTCollection_NotFound(t *testing.T) {
	h := setup(t)
	ctx := context.Background()
	_, err := h.svc.GetNFTCollection(ctx, connect.NewRequest(&membav1.GetNFTCollectionRequest{
		CollectionId: "nope",
	}))
	if err == nil {
		t.Fatal("expected NotFound error")
	}
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Errorf("expected NotFound, got %v", connect.CodeOf(err))
	}
}

func TestGetNFTCollection_EmptyID(t *testing.T) {
	h := setup(t)
	ctx := context.Background()
	_, err := h.svc.GetNFTCollection(ctx, connect.NewRequest(&membav1.GetNFTCollectionRequest{
		CollectionId: "",
	}))
	if err == nil {
		t.Fatal("expected error for empty collection_id")
	}
}

func TestGetNFTActivity(t *testing.T) {
	h := setup(t)
	seedNFTCollection(t, h)
	ctx := context.Background()

	resp, err := h.svc.GetNFTActivity(ctx, connect.NewRequest(&membav1.GetNFTActivityRequest{
		CollectionId: "genesis",
	}))
	if err != nil {
		t.Fatal("GetNFTActivity:", err)
	}
	if len(resp.Msg.Items) != 2 {
		t.Fatalf("expected 2 activity items, got %d", len(resp.Msg.Items))
	}
	// Newest first (event position DESC). Block 200 sale is newest (id=2).
	if resp.Msg.Items[0].SaleNo != 2 {
		t.Errorf("first item sale_no = %d, want 2 (newest first)", resp.Msg.Items[0].SaleNo)
	}
	if resp.Msg.Items[0].PriceUgnot != 1250000 {
		t.Errorf("price = %d", resp.Msg.Items[0].PriceUgnot)
	}
	if resp.Msg.Items[0].Seller != "g1seller2" {
		t.Errorf("seller = %q, want g1seller2 (full untruncated)", resp.Msg.Items[0].Seller)
	}
}

func TestGetNFTActivity_Limit(t *testing.T) {
	h := setup(t)
	seedNFTCollection(t, h)
	ctx := context.Background()

	resp, err := h.svc.GetNFTActivity(ctx, connect.NewRequest(&membav1.GetNFTActivityRequest{
		CollectionId: "genesis",
		Limit:        1,
	}))
	if err != nil {
		t.Fatal("GetNFTActivity:", err)
	}
	if len(resp.Msg.Items) != 1 {
		t.Fatalf("expected 1 item with limit=1, got %d", len(resp.Msg.Items))
	}
}

func TestGetNFTPortfolio(t *testing.T) {
	h := setup(t)
	seedNFTCollection(t, h)
	ctx := context.Background()

	resp, err := h.svc.GetNFTPortfolio(ctx, connect.NewRequest(&membav1.GetNFTPortfolioRequest{
		Owner: "g1alice",
	}))
	if err != nil {
		t.Fatal("GetNFTPortfolio:", err)
	}
	// Alice owns tokens 1 and 3.
	if len(resp.Msg.Tokens) != 2 {
		t.Fatalf("expected 2 tokens for g1alice, got %d", len(resp.Msg.Tokens))
	}
	for _, tok := range resp.Msg.Tokens {
		if tok.Owner != "g1alice" {
			t.Errorf("unexpected owner %q", tok.Owner)
		}
	}
}

func TestGetNFTPortfolio_Empty(t *testing.T) {
	h := setup(t)
	seedNFTCollection(t, h)
	ctx := context.Background()

	resp, err := h.svc.GetNFTPortfolio(ctx, connect.NewRequest(&membav1.GetNFTPortfolioRequest{
		Owner: "g1nobody",
	}))
	if err != nil {
		t.Fatal("GetNFTPortfolio:", err)
	}
	if len(resp.Msg.Tokens) != 0 {
		t.Fatalf("expected 0 tokens, got %d", len(resp.Msg.Tokens))
	}
}

func TestListNFTTokens_All(t *testing.T) {
	h := setup(t)
	seedNFTCollection(t, h)
	ctx := context.Background()

	resp, err := h.svc.ListNFTTokens(ctx, connect.NewRequest(&membav1.ListNFTTokensRequest{
		CollectionId: "genesis",
	}))
	if err != nil {
		t.Fatal("ListNFTTokens:", err)
	}
	if len(resp.Msg.Tokens) != 3 {
		t.Fatalf("expected 3 tokens, got %d", len(resp.Msg.Tokens))
	}
}

func TestListNFTTokens_ListedOnly(t *testing.T) {
	h := setup(t)
	seedNFTCollection(t, h)
	ctx := context.Background()

	resp, err := h.svc.ListNFTTokens(ctx, connect.NewRequest(&membav1.ListNFTTokensRequest{
		CollectionId: "genesis",
		ListedOnly:   true,
	}))
	if err != nil {
		t.Fatal("ListNFTTokens:", err)
	}
	if len(resp.Msg.Tokens) != 1 {
		t.Fatalf("expected 1 listed token, got %d", len(resp.Msg.Tokens))
	}
	tok := resp.Msg.Tokens[0]
	if tok.TokenId != "2" || !tok.Listed || tok.PriceUgnot != 500000 {
		t.Errorf("listed token = %+v", tok)
	}
}
