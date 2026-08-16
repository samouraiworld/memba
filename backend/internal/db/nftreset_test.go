package db

import (
	"path/filepath"
	"testing"
)

// The reset must wipe ALL nine NFT tables in one shot — a cursor-only reset
// leaves event-keyed projections colliding across chains, and a projection-only
// reset leaves the MIN-across-realms cursor pinned above a young chain's head
// ("silently indexes nothing"), so the test seeds BOTH state and a projection
// and asserts both go to zero.
func TestResetNFTState_WipesAllNineTables(t *testing.T) {
	path := filepath.Join(t.TempDir(), "nftreset.db")
	database, err := Open(path)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	if err := Migrate(database); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	seed := []string{
		`INSERT INTO nft_indexer_state (realm_path, last_processed_block, updated_at)
		 VALUES ('gno.land/r/samcrew/memba_nft_market_v3_2', 260101, '2026-08-10T14:28:26Z')`,
		`INSERT INTO nft_collections (collection_id, realm, name, symbol, supply, total_volume_ugnot, total_sales)
		 VALUES ('g1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/old', 'gno.land/r/samcrew/memba_collections', 'Old Chain', 'OLD', 1, 1000000, 1)`,
	}
	for _, q := range seed {
		if _, err := database.Exec(q); err != nil {
			t.Fatalf("seed (%s): %v", q[:40], err)
		}
	}
	if err := database.Close(); err != nil {
		t.Fatalf("close: %v", err)
	}

	counts, err := ResetNFTState(path)
	if err != nil {
		t.Fatalf("ResetNFTState: %v", err)
	}
	if counts["nft_indexer_state"] != 1 {
		t.Fatalf("nft_indexer_state deleted=%d, want 1", counts["nft_indexer_state"])
	}
	if counts["nft_collections"] != 1 {
		t.Fatalf("nft_collections deleted=%d, want 1", counts["nft_collections"])
	}
	for _, table := range nftResetTables {
		if _, ok := counts[table]; !ok {
			t.Fatalf("missing count for %s — a table left out of the reset is the stale-projection path", table)
		}
	}

	verify, err := Open(path)
	if err != nil {
		t.Fatalf("reopen: %v", err)
	}
	defer func() { _ = verify.Close() }()
	for _, table := range []string{"nft_indexer_state", "nft_collections"} {
		var n int
		if err := verify.QueryRow("SELECT COUNT(*) FROM " + table).Scan(&n); err != nil {
			t.Fatalf("count %s: %v", table, err)
		}
		if n != 0 {
			t.Fatalf("%s has %d rows after reset, want 0", table, n)
		}
	}
}

// A missing database file must be an error — SQLite would otherwise CREATE an
// empty db and report a successful "reset" of nothing (the integrity-check
// lesson, applied here).
func TestResetNFTState_RefusesMissingFile(t *testing.T) {
	if _, err := ResetNFTState(filepath.Join(t.TempDir(), "absent.db")); err == nil {
		t.Fatal("expected an error for a missing database file")
	}
}
