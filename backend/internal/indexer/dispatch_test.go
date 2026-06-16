package indexer

import (
	"context"
	"database/sql"
	"testing"
)

// ev builds a GnoEvent at a given position with the supplied attributes.
func ev(typ, pkg string, block int64, tx, idx int, attrs map[string]string) GnoEvent {
	return GnoEvent{Type: typ, PkgPath: pkg, Attrs: attrs, Block: block, TxIndex: tx, EventIdx: idx}
}

const (
	marketPkg = "gno.land/r/samcrew/memba_nft_market_v2"
	colPkg    = "gno.land/r/samcrew/memba_nft_v2"
)

func countRows(t *testing.T, db *sql.DB, query string, args ...any) int {
	t.Helper()
	var n int
	if err := db.QueryRow(query, args...).Scan(&n); err != nil {
		t.Fatal("count:", err)
	}
	return n
}

func TestDispatch_NFTListed_SetsFloor(t *testing.T) {
	db := openTestDB(t)
	ctx := context.Background()

	must(t, dispatchEvent(ctx, db, ev("NFTListed", marketPkg, 100, 0, 0, map[string]string{
		"collection": "genesis", "tokenId": "1", "seller": "g1sellerfull", "price": "1500000",
	})))

	if n := countRows(t, db, `SELECT COUNT(*) FROM nft_listings`); n != 1 {
		t.Fatalf("listings = %d, want 1", n)
	}
	var listed int
	var price sql.NullInt64
	var seller sql.NullString
	if err := db.QueryRow(`SELECT listed, price_ugnot, listing_seller FROM nft_tokens WHERE collection_id='genesis' AND token_id='1'`).
		Scan(&listed, &price, &seller); err != nil {
		t.Fatal(err)
	}
	if listed != 1 || price.Int64 != 1500000 || seller.String != "g1sellerfull" {
		t.Errorf("token = listed%d price%d seller%q", listed, price.Int64, seller.String)
	}

	var floor sql.NullInt64
	if err := db.QueryRow(`SELECT floor_price_ugnot FROM nft_collections WHERE collection_id='genesis'`).Scan(&floor); err != nil {
		t.Fatal(err)
	}
	if floor.Int64 != 1500000 {
		t.Errorf("floor = %d, want 1500000", floor.Int64)
	}
}

func TestDispatch_FloorRecomputeAcrossListings(t *testing.T) {
	db := openTestDB(t)
	ctx := context.Background()

	must(t, dispatchEvent(ctx, db, ev("NFTListed", marketPkg, 100, 0, 0, map[string]string{
		"collection": "genesis", "tokenId": "1", "seller": "g1a", "price": "3000000",
	})))
	must(t, dispatchEvent(ctx, db, ev("NFTListed", marketPkg, 101, 0, 0, map[string]string{
		"collection": "genesis", "tokenId": "2", "seller": "g1b", "price": "1000000",
	})))

	var floor int64
	must(t, db.QueryRow(`SELECT floor_price_ugnot FROM nft_collections WHERE collection_id='genesis'`).Scan(&floor))
	if floor != 1000000 {
		t.Fatalf("floor = %d, want 1000000 (min of two listings)", floor)
	}

	// Delist the cheaper one → floor rises to the remaining listing.
	must(t, dispatchEvent(ctx, db, ev("NFTDelisted", marketPkg, 102, 0, 0, map[string]string{
		"collection": "genesis", "tokenId": "2", "seller": "g1b",
	})))
	must(t, db.QueryRow(`SELECT floor_price_ugnot FROM nft_collections WHERE collection_id='genesis'`).Scan(&floor))
	if floor != 3000000 {
		t.Fatalf("floor after delist = %d, want 3000000", floor)
	}
}

func TestDispatch_PurchaseConfirmed(t *testing.T) {
	db := openTestDB(t)
	ctx := context.Background()

	// List then buy.
	must(t, dispatchEvent(ctx, db, ev("NFTListed", marketPkg, 100, 0, 0, map[string]string{
		"collection": "genesis", "tokenId": "1", "seller": "g1seller", "price": "1500000",
	})))
	must(t, dispatchEvent(ctx, db, ev("PurchaseConfirmed", marketPkg, 101, 0, 0, map[string]string{
		"collection": "genesis", "tokenId": "1", "buyer": "g1buyer", "seller": "g1seller",
		"price": "1500000", "fee": "37500", "royalty": "75000", "sellerAmount": "1387500",
	})))

	if n := countRows(t, db, `SELECT COUNT(*) FROM nft_sales`); n != 1 {
		t.Fatalf("sales = %d, want 1", n)
	}
	var fee, royalty int64
	must(t, db.QueryRow(`SELECT fee_ugnot, royalty_ugnot FROM nft_sales`).Scan(&fee, &royalty))
	if fee != 37500 || royalty != 75000 {
		t.Errorf("fee/royalty = %d/%d", fee, royalty)
	}

	// Token now owned by buyer, unlisted.
	var owner string
	var listed int
	must(t, db.QueryRow(`SELECT owner, listed FROM nft_tokens WHERE collection_id='genesis' AND token_id='1'`).Scan(&owner, &listed))
	if owner != "g1buyer" || listed != 0 {
		t.Errorf("token = owner%q listed%d", owner, listed)
	}

	// Listing closed.
	var delisted sql.NullInt64
	must(t, db.QueryRow(`SELECT delisted_at_block FROM nft_listings WHERE collection_id='genesis' AND token_id='1'`).Scan(&delisted))
	if !delisted.Valid {
		t.Error("listing not closed after purchase")
	}

	// Collection aggregates.
	var vol, sales, lastSale int64
	must(t, db.QueryRow(`SELECT total_volume_ugnot, total_sales, last_sale_price_ugnot FROM nft_collections WHERE collection_id='genesis'`).Scan(&vol, &sales, &lastSale))
	if vol != 1500000 || sales != 1 || lastSale != 1500000 {
		t.Errorf("aggregates vol%d sales%d last%d", vol, sales, lastSale)
	}

	// Ownership history.
	if n := countRows(t, db, `SELECT COUNT(*) FROM nft_ownership_history WHERE kind='sale'`); n != 1 {
		t.Errorf("ownership history rows = %d, want 1", n)
	}

	// Floor cleared (no more listings).
	var floor sql.NullInt64
	must(t, db.QueryRow(`SELECT floor_price_ugnot FROM nft_collections WHERE collection_id='genesis'`).Scan(&floor))
	if floor.Valid {
		t.Errorf("floor = %d, want NULL after only listing sold", floor.Int64)
	}
}

func TestDispatch_PurchaseIdempotent(t *testing.T) {
	db := openTestDB(t)
	ctx := context.Background()

	purchase := ev("PurchaseConfirmed", marketPkg, 101, 0, 0, map[string]string{
		"collection": "genesis", "tokenId": "1", "buyer": "g1buyer", "seller": "g1seller",
		"price": "1500000", "fee": "37500", "royalty": "75000",
	})
	must(t, dispatchEvent(ctx, db, purchase))
	// Re-process the SAME event (replay).
	must(t, dispatchEvent(ctx, db, purchase))

	if n := countRows(t, db, `SELECT COUNT(*) FROM nft_sales`); n != 1 {
		t.Fatalf("sales after replay = %d, want 1 (idempotent)", n)
	}
	// Aggregates must not double-count.
	var vol, sales int64
	must(t, db.QueryRow(`SELECT total_volume_ugnot, total_sales FROM nft_collections WHERE collection_id='genesis'`).Scan(&vol, &sales))
	if vol != 1500000 || sales != 1 {
		t.Errorf("aggregates double-counted: vol%d sales%d", vol, sales)
	}
}

func TestDispatch_OfferLifecycle(t *testing.T) {
	db := openTestDB(t)
	ctx := context.Background()

	must(t, dispatchEvent(ctx, db, ev("OfferMade", marketPkg, 100, 0, 0, map[string]string{
		"collection": "genesis", "tokenId": "1", "buyer": "g1bidder", "amount": "900000",
	})))
	var status string
	must(t, db.QueryRow(`SELECT status FROM nft_offers WHERE collection_id='genesis' AND token_id='1' AND buyer='g1bidder'`).Scan(&status))
	if status != "active" {
		t.Fatalf("offer status = %q, want active", status)
	}

	must(t, dispatchEvent(ctx, db, ev("OfferCancelled", marketPkg, 101, 0, 0, map[string]string{
		"collection": "genesis", "tokenId": "1", "buyer": "g1bidder", "amount": "900000",
	})))
	must(t, db.QueryRow(`SELECT status FROM nft_offers WHERE collection_id='genesis' AND token_id='1' AND buyer='g1bidder'`).Scan(&status))
	if status != "cancelled" {
		t.Fatalf("offer status = %q, want cancelled", status)
	}
}

func TestDispatch_OfferAccepted(t *testing.T) {
	db := openTestDB(t)
	ctx := context.Background()

	must(t, dispatchEvent(ctx, db, ev("OfferMade", marketPkg, 100, 0, 0, map[string]string{
		"collection": "genesis", "tokenId": "1", "buyer": "g1bidder", "amount": "900000",
	})))
	must(t, dispatchEvent(ctx, db, ev("OfferAccepted", marketPkg, 101, 0, 0, map[string]string{
		"collection": "genesis", "tokenId": "1", "seller": "g1owner", "buyer": "g1bidder",
		"amount": "900000", "fee": "22500", "royalty": "45000", "sellerAmount": "832500",
	})))

	var kind string
	var price int64
	must(t, db.QueryRow(`SELECT kind, price_ugnot FROM nft_sales WHERE collection_id='genesis' AND token_id='1'`).Scan(&kind, &price))
	if kind != "offer" || price != 900000 {
		t.Errorf("sale kind/price = %q/%d", kind, price)
	}

	var status string
	must(t, db.QueryRow(`SELECT status FROM nft_offers WHERE buyer='g1bidder'`).Scan(&status))
	if status != "accepted" {
		t.Errorf("offer status = %q, want accepted", status)
	}

	var owner string
	must(t, db.QueryRow(`SELECT owner FROM nft_tokens WHERE collection_id='genesis' AND token_id='1'`).Scan(&owner))
	if owner != "g1bidder" {
		t.Errorf("owner = %q, want g1bidder", owner)
	}
}

func TestDispatch_MarketTransfer(t *testing.T) {
	db := openTestDB(t)
	ctx := context.Background()

	must(t, dispatchEvent(ctx, db, ev("MarketTransfer", colPkg, 100, 0, 0, map[string]string{
		"collection": "genesis", "from": "g1from", "to": "g1to", "tokenId": "5",
	})))

	var owner string
	must(t, db.QueryRow(`SELECT owner FROM nft_tokens WHERE collection_id='genesis' AND token_id='5'`).Scan(&owner))
	if owner != "g1to" {
		t.Errorf("owner = %q, want g1to", owner)
	}
	if n := countRows(t, db, `SELECT COUNT(*) FROM nft_ownership_history WHERE kind='transfer'`); n != 1 {
		t.Errorf("transfer history = %d, want 1", n)
	}
}

func TestDispatch_Mint(t *testing.T) {
	db := openTestDB(t)
	ctx := context.Background()

	must(t, dispatchEvent(ctx, db, ev("Mint", colPkg, 50, 0, 0, map[string]string{
		"collection": "genesis", "to": "g1minter", "tokenId": "1",
	})))

	var owner string
	var minted sql.NullInt64
	must(t, db.QueryRow(`SELECT owner, minted_block FROM nft_tokens WHERE collection_id='genesis' AND token_id='1'`).Scan(&owner, &minted))
	if owner != "g1minter" || minted.Int64 != 50 {
		t.Errorf("token = owner%q minted%d", owner, minted.Int64)
	}
	if n := countRows(t, db, `SELECT COUNT(*) FROM nft_ownership_history WHERE kind='mint'`); n != 1 {
		t.Errorf("mint history = %d, want 1", n)
	}
}

func TestDispatch_CollectionCreated(t *testing.T) {
	db := openTestDB(t)
	ctx := context.Background()

	must(t, dispatchEvent(ctx, db, ev("CollectionCreated", colPkg, 10, 0, 0, map[string]string{
		"collection": "genesis", "name": "Memba Genesis", "symbol": "MGEN",
		"royaltyBPS": "500", "royaltyRecipient": "g1royalty",
	})))

	var name, symbol string
	var royalty int64
	must(t, db.QueryRow(`SELECT name, symbol, royalty_bps FROM nft_collections WHERE collection_id='genesis'`).Scan(&name, &symbol, &royalty))
	if name != "Memba Genesis" || symbol != "MGEN" || royalty != 500 {
		t.Errorf("collection = %q %q %d", name, symbol, royalty)
	}
}

func TestDispatch_UnknownTypeIgnored(t *testing.T) {
	db := openTestDB(t)
	ctx := context.Background()
	if err := dispatchEvent(ctx, db, ev("CollectionPaused", colPkg, 1, 0, 0, map[string]string{"collection": "genesis"})); err != nil {
		t.Fatalf("unknown type should be a no-op, got %v", err)
	}
	if err := dispatchEvent(ctx, db, ev("TokenSold", marketPkg, 1, 0, 0, map[string]string{"collection": "genesis"})); err != nil {
		t.Fatalf("TokenSold should be skipped, got %v", err)
	}
}

func must(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
}
