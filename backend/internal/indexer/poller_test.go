package indexer

import (
	"context"
	"database/sql"
	"testing"

	"github.com/samouraiworld/memba/backend/internal/db"
	_ "modernc.org/sqlite"
)

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

func TestUpsertCollection(t *testing.T) {
	database := openTestDB(t)
	ctx := context.Background()

	if err := upsertCollection(ctx, database, "genesis", "gno.land/r/x", collectionInfo{
		Name: "Memba Genesis", Symbol: "MGEN", Supply: 3, RoyaltyBPS: 500,
	}); err != nil {
		t.Fatal("upsertCollection:", err)
	}

	var name, symbol string
	var supply, royalty int64
	err := database.QueryRow(`SELECT name, symbol, supply, royalty_bps FROM nft_collections WHERE collection_id = ?`, "genesis").
		Scan(&name, &symbol, &supply, &royalty)
	if err != nil {
		t.Fatal("scan:", err)
	}
	if name != "Memba Genesis" || symbol != "MGEN" || supply != 3 || royalty != 500 {
		t.Errorf("metadata mismatch: %s %s %d %d", name, symbol, supply, royalty)
	}
}
