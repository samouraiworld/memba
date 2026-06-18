package indexer

import (
	"context"
	"testing"
)

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
