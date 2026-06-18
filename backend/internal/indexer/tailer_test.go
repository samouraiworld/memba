package indexer

import (
	"context"
	"testing"
)

func TestConfirmedEnd_DefaultDepth(t *testing.T) {
	// StartNFTTailer applies Confirmations<=0 → 5. Here we assert the arithmetic
	// the env value drives: with depth 5, latest=1000 yields a safe tip of 995.
	if got := confirmedEnd(1000, 5, 990, 500); got != 995 {
		t.Fatalf("confirmedEnd with default depth = %d, want 995", got)
	}
}

func TestCursor_DefaultsToStartBlockMinusOne(t *testing.T) {
	db := openTestDB(t)
	ctx := context.Background()
	realms := []string{marketPkg, colPkg}

	got, _, err := loadCursor(ctx, db, realms, 260000)
	if err != nil {
		t.Fatal(err)
	}
	if got != 259999 {
		t.Fatalf("first-run cursor = %d, want startBlock-1 (259999)", got)
	}
}

func TestCursor_SaveThenLoad(t *testing.T) {
	db := openTestDB(t)
	ctx := context.Background()
	realms := []string{marketPkg, colPkg}

	if err := saveCursor(ctx, db, realms, 263500, "HASH263500"); err != nil {
		t.Fatal("saveCursor:", err)
	}
	got, hash, err := loadCursor(ctx, db, realms, 260000)
	if err != nil {
		t.Fatal(err)
	}
	if got != 263500 {
		t.Fatalf("cursor = %d, want 263500", got)
	}
	if hash != "HASH263500" {
		t.Fatalf("hash = %q, want HASH263500", hash)
	}
}

func TestCursor_TakesMinAcrossRealms(t *testing.T) {
	db := openTestDB(t)
	ctx := context.Background()

	// Advance only one realm; the other is unset → cursor must not skip ahead.
	if err := saveCursor(ctx, db, []string{marketPkg}, 263500, "H263500"); err != nil {
		t.Fatal(err)
	}
	got, _, err := loadCursor(ctx, db, []string{marketPkg, colPkg}, 260000)
	if err != nil {
		t.Fatal(err)
	}
	// colPkg is unset → defaults to 259999, which is the min.
	if got != 259999 {
		t.Fatalf("cursor = %d, want 259999 (min across realms, unset wins)", got)
	}
}

func TestCursor_Monotonic(t *testing.T) {
	db := openTestDB(t)
	ctx := context.Background()
	realms := []string{marketPkg}

	if err := saveCursor(ctx, db, realms, 100, "H100"); err != nil {
		t.Fatal(err)
	}
	if err := saveCursor(ctx, db, realms, 200, "H200"); err != nil {
		t.Fatal(err)
	}
	got, _, err := loadCursor(ctx, db, realms, 1)
	if err != nil {
		t.Fatal(err)
	}
	if got != 200 {
		t.Fatalf("cursor = %d, want 200", got)
	}
}

// TestTailer_BadBlockTolerant verifies a parser error on one block doesn't panic
// or corrupt state: the parse helper returns an error and the loop logs+returns.
// (Full network loop is not exercised against the live chain per the brief.)
func TestParseBlockResults_BadBlockReturnsError(t *testing.T) {
	if _, err := parseBlockResults([]byte(`garbage`), 5); err == nil {
		t.Fatal("expected parse error to propagate (tailer logs & retries)")
	}
}

func TestSeedRealmCursor(t *testing.T) {
	db := openTestDB(t)
	ctx := context.Background()
	const offers = "gno.land/r/samcrew/memba_nft_offers_v1"

	must(t, SeedRealmCursor(ctx, db, offers, 280000))
	got, _, err := loadCursor(ctx, db, []string{offers}, defaultStartBlock)
	must(t, err)
	if got != 279999 {
		t.Fatalf("seeded cursor = %d, want 279999 (deployHeight-1)", got)
	}
	// Idempotent: seeding again (e.g. after it has advanced) must NOT rewind.
	must(t, saveCursor(ctx, db, []string{offers}, 285000, ""))
	must(t, SeedRealmCursor(ctx, db, offers, 280000))
	got, _, err = loadCursor(ctx, db, []string{offers}, defaultStartBlock)
	must(t, err)
	if got != 285000 {
		t.Fatalf("cursor after re-seed = %d, want 285000 (no rewind)", got)
	}
}
