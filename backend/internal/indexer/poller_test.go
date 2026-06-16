package indexer

import (
	"context"
	"database/sql"
	"testing"

	"github.com/samouraiworld/memba/backend/internal/db"
	_ "modernc.org/sqlite"
)

func TestGnotToUgnot(t *testing.T) {
	cases := []struct {
		in   string
		want int64
	}{
		{"0.000000 GNOT", 0},
		{"0.500000 GNOT", 500_000},
		{"1.500000 GNOT", 1_500_000},
		{"1.500000", 1_500_000},
		{"2.000000 GNOT", 2_000_000},
		{"10.123456 GNOT", 10_123_456},
		{"3 GNOT", 3_000_000},
		{"0.5", 500_000},
		{".5", 500_000},
		{"", 0},
		{"garbage", 0},
	}
	for _, c := range cases {
		if got := gnotToUgnot(c.in); got != c.want {
			t.Errorf("gnotToUgnot(%q) = %d, want %d", c.in, got, c.want)
		}
	}
}

func TestParseCollectionRender(t *testing.T) {
	const sample = `# Memba Genesis

Symbol: MGEN
Supply: 3
Royalty BPS: 500
Royalty Recipient: g1x7k...
`
	c, err := parseCollectionRender(sample)
	if err != nil {
		t.Fatal("parseCollectionRender:", err)
	}
	if c.Name != "Memba Genesis" {
		t.Errorf("name = %q, want Memba Genesis", c.Name)
	}
	if c.Symbol != "MGEN" {
		t.Errorf("symbol = %q, want MGEN", c.Symbol)
	}
	if c.Supply != 3 {
		t.Errorf("supply = %d, want 3", c.Supply)
	}
	if c.RoyaltyBPS != 500 {
		t.Errorf("royaltyBPS = %d, want 500", c.RoyaltyBPS)
	}
}

func TestParseCollectionRender_Empty(t *testing.T) {
	if _, err := parseCollectionRender(""); err == nil {
		t.Fatal("expected error for empty input")
	}
}

func TestParseTokenRender(t *testing.T) {
	const sample = `# Token 1

Owner: g1x7kqy8w9z0abcdefghijklmnopqrstuvwxyz12
URI: ipfs://memba-genesis-placeholder/1
`
	tok, err := parseTokenRender(sample)
	if err != nil {
		t.Fatal("parseTokenRender:", err)
	}
	if tok.Owner != "g1x7kqy8w9z0abcdefghijklmnopqrstuvwxyz12" {
		t.Errorf("owner = %q", tok.Owner)
	}
	if tok.URI != "ipfs://memba-genesis-placeholder/1" {
		t.Errorf("uri = %q", tok.URI)
	}
}

func TestParseTokenRender_NoOwner(t *testing.T) {
	if _, err := parseTokenRender("# Token 1\n\nURI: ipfs://x\n"); err == nil {
		t.Fatal("expected error when owner missing")
	}
}

func TestParseStatsRender(t *testing.T) {
	const sample = `# Marketplace Stats

**Active Listings:** 0
**Total Sales:** 0
**Total Volume:** 0.000000 GNOT
**Active Offers:** 0
**Platform Fee:** 2.50%
**Max Royalty:** 10%
`
	st, err := parseStatsRender(sample)
	if err != nil {
		t.Fatal("parseStatsRender:", err)
	}
	if st.ActiveListings != 0 || st.TotalSales != 0 || st.TotalVolumeUgnot != 0 || st.ActiveOffers != 0 {
		t.Errorf("unexpected zero-stats: %+v", st)
	}
}

func TestParseStatsRender_NonZero(t *testing.T) {
	const sample = `# Marketplace Stats

**Active Listings:** 2
**Total Sales:** 5
**Total Volume:** 1.500000 GNOT
**Active Offers:** 3
**Platform Fee:** 2.50%
`
	st, err := parseStatsRender(sample)
	if err != nil {
		t.Fatal("parseStatsRender:", err)
	}
	if st.ActiveListings != 2 {
		t.Errorf("active listings = %d, want 2", st.ActiveListings)
	}
	if st.TotalSales != 5 {
		t.Errorf("total sales = %d, want 5", st.TotalSales)
	}
	if st.TotalVolumeUgnot != 1_500_000 {
		t.Errorf("volume = %d, want 1500000", st.TotalVolumeUgnot)
	}
	if st.ActiveOffers != 3 {
		t.Errorf("offers = %d, want 3", st.ActiveOffers)
	}
}

func TestParseListingsRender(t *testing.T) {
	const sample = `# NFT Marketplace

**Active Listings:** 2
**Total Volume:** 1.500000 GNOT

| # | Collection | Token | Price | Seller |
|---|-----------|-------|-------|--------|
| 1 | genesis | 2 | 0.500000 GNOT | g1ab…xy |
| 2 | genesis | 5 | 0.750000 GNOT | g1cd…zw |
`
	got, err := parseListingsRender(sample)
	if err != nil {
		t.Fatal("parseListingsRender:", err)
	}
	if len(got) != 2 {
		t.Fatalf("expected 2 listings, got %d: %+v", len(got), got)
	}
	if got[0].TokenID != "2" || got[0].PriceUgnot != 500_000 {
		t.Errorf("listing[0] = %+v, want {2, 500000}", got[0])
	}
	if got[1].TokenID != "5" || got[1].PriceUgnot != 750_000 {
		t.Errorf("listing[1] = %+v, want {5, 750000}", got[1])
	}
}

func TestParseSalesRender(t *testing.T) {
	const sample = `# Recent Sales

| Sale | Collection | Token | Price | Seller | Buyer |
|------|-----------|-------|-------|--------|-------|
| 1 | genesis | 1 | 0.500000 GNOT | g1ab…xy | g1cd…zw |
| 2 | genesis | 3 | 1.250000 GNOT | g1ef…uv | g1gh…st |
`
	got, err := parseSalesRender(sample)
	if err != nil {
		t.Fatal("parseSalesRender:", err)
	}
	if len(got) != 2 {
		t.Fatalf("expected 2 sales, got %d: %+v", len(got), got)
	}
	if got[0].SaleNo != 1 || got[0].TokenID != "1" || got[0].PriceUgnot != 500_000 {
		t.Errorf("sale[0] = %+v", got[0])
	}
	if got[0].Seller != "g1ab…xy" || got[0].Buyer != "g1cd…zw" {
		t.Errorf("sale[0] addrs = %q / %q", got[0].Seller, got[0].Buyer)
	}
	if got[1].SaleNo != 2 || got[1].PriceUgnot != 1_250_000 {
		t.Errorf("sale[1] = %+v", got[1])
	}
}

// ── DB-write helpers (in-memory SQLite) ──────────────────────────────────────

func openTestDB(t *testing.T) *sql.DB {
	t.Helper()
	database, err := db.Open(":memory:")
	if err != nil {
		t.Fatal("open db:", err)
	}
	if err := db.Migrate(database); err != nil {
		t.Fatal("migrate:", err)
	}
	t.Cleanup(func() { _ = database.Close() })
	return database
}

func TestUpsertCollectionAndStats(t *testing.T) {
	database := openTestDB(t)
	ctx := context.Background()

	if err := upsertCollection(ctx, database, "genesis", "gno.land/r/x", collectionInfo{
		Name: "Memba Genesis", Symbol: "MGEN", Supply: 3, RoyaltyBPS: 500,
	}); err != nil {
		t.Fatal("upsertCollection:", err)
	}
	if err := updateCollectionStats(ctx, database, "genesis", statsInfo{
		TotalVolumeUgnot: 1_500_000, TotalSales: 5, ActiveListings: 2,
	}); err != nil {
		t.Fatal("updateCollectionStats:", err)
	}

	var name, symbol string
	var supply, royalty, vol, sales, listings int64
	err := database.QueryRow(`SELECT name, symbol, supply, royalty_bps, total_volume_ugnot, total_sales, active_listings FROM nft_collections WHERE collection_id = ?`, "genesis").
		Scan(&name, &symbol, &supply, &royalty, &vol, &sales, &listings)
	if err != nil {
		t.Fatal("scan:", err)
	}
	if name != "Memba Genesis" || symbol != "MGEN" || supply != 3 || royalty != 500 {
		t.Errorf("metadata mismatch: %s %s %d %d", name, symbol, supply, royalty)
	}
	if vol != 1_500_000 || sales != 5 || listings != 2 {
		t.Errorf("stats mismatch: %d %d %d", vol, sales, listings)
	}
}

func TestApplyListingsFloor(t *testing.T) {
	database := openTestDB(t)
	ctx := context.Background()

	_ = upsertCollection(ctx, database, "genesis", "r", collectionInfo{Name: "G", Supply: 3})
	_ = upsertToken(ctx, database, "genesis", "1", tokenInfo{Owner: "g1a", URI: "u1"})
	_ = upsertToken(ctx, database, "genesis", "2", tokenInfo{Owner: "g1b", URI: "u2"})

	if err := applyListings(ctx, database, "genesis", []listingInfo{
		{TokenID: "2", PriceUgnot: 750_000},
		{TokenID: "5", PriceUgnot: 500_000},
	}); err != nil {
		t.Fatal("applyListings:", err)
	}

	var floor int64
	if err := database.QueryRow(`SELECT floor_price_ugnot FROM nft_collections WHERE collection_id = ?`, "genesis").Scan(&floor); err != nil {
		t.Fatal("scan floor:", err)
	}
	if floor != 500_000 {
		t.Errorf("floor = %d, want 500000 (min listed)", floor)
	}

	// Token 2 listed; token 1 not listed; owner/uri preserved on token 2.
	var listed int64
	var price sql.NullInt64
	var owner string
	if err := database.QueryRow(`SELECT listed, price_ugnot, owner FROM nft_tokens WHERE collection_id = ? AND token_id = ?`, "genesis", "2").Scan(&listed, &price, &owner); err != nil {
		t.Fatal("scan token2:", err)
	}
	if listed != 1 || !price.Valid || price.Int64 != 750_000 {
		t.Errorf("token2 listing state wrong: listed=%d price=%+v", listed, price)
	}
	if owner != "g1b" {
		t.Errorf("token2 owner not preserved: %q", owner)
	}

	if err := database.QueryRow(`SELECT listed FROM nft_tokens WHERE collection_id = ? AND token_id = ?`, "genesis", "1").Scan(&listed); err != nil {
		t.Fatal("scan token1:", err)
	}
	if listed != 0 {
		t.Errorf("token1 should be unlisted, got listed=%d", listed)
	}
}

func TestInsertSalesDedup(t *testing.T) {
	database := openTestDB(t)
	ctx := context.Background()

	sales := []saleInfo{
		{SaleNo: 1, TokenID: "1", PriceUgnot: 500_000, Seller: "g1a", Buyer: "g1b"},
		{SaleNo: 2, TokenID: "3", PriceUgnot: 1_250_000, Seller: "g1c", Buyer: "g1d"},
	}
	if err := insertSales(ctx, database, "genesis", sales); err != nil {
		t.Fatal("insertSales:", err)
	}
	// Re-insert the same sales — must be deduped by (collection_id, sale_no).
	if err := insertSales(ctx, database, "genesis", sales); err != nil {
		t.Fatal("insertSales (dedup):", err)
	}

	var count int
	if err := database.QueryRow(`SELECT COUNT(*) FROM nft_activity WHERE collection_id = ?`, "genesis").Scan(&count); err != nil {
		t.Fatal("count:", err)
	}
	if count != 2 {
		t.Errorf("expected 2 deduped activity rows, got %d", count)
	}
}
