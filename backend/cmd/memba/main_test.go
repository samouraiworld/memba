package main

import (
	"testing"
)

func TestParseSeedCursorSpec(t *testing.T) {
	t.Run("empty input returns nil slice and no errors", func(t *testing.T) {
		got, errs := parseSeedCursorSpec("")
		if len(errs) != 0 {
			t.Fatalf("unexpected errors: %v", errs)
		}
		if len(got) != 0 {
			t.Errorf("expected empty slice, got %v", got)
		}
	})

	t.Run("whitespace-only input returns nil slice and no errors", func(t *testing.T) {
		got, errs := parseSeedCursorSpec("   ")
		if len(errs) != 0 {
			t.Fatalf("unexpected errors: %v", errs)
		}
		if len(got) != 0 {
			t.Errorf("expected empty slice, got %v", got)
		}
	})

	t.Run("single valid pair", func(t *testing.T) {
		got, errs := parseSeedCursorSpec("gno.land/r/samcrew/memba_nft_market_v3@280000")
		if len(errs) != 0 {
			t.Fatalf("unexpected errors: %v", errs)
		}
		if len(got) != 1 {
			t.Fatalf("expected 1 entry, got %d", len(got))
		}
		if got[0].Realm != "gno.land/r/samcrew/memba_nft_market_v3" {
			t.Errorf("realm: got %q, want %q", got[0].Realm, "gno.land/r/samcrew/memba_nft_market_v3")
		}
		if got[0].Height != 280000 {
			t.Errorf("height: got %d, want 280000", got[0].Height)
		}
	})

	t.Run("multiple valid pairs", func(t *testing.T) {
		got, errs := parseSeedCursorSpec("gno.land/r/a/b@100,gno.land/r/c/d@200")
		if len(errs) != 0 {
			t.Fatalf("unexpected errors: %v", errs)
		}
		if len(got) != 2 {
			t.Fatalf("expected 2 entries, got %d", len(got))
		}
		if got[0].Realm != "gno.land/r/a/b" || got[0].Height != 100 {
			t.Errorf("entry 0: got %+v", got[0])
		}
		if got[1].Realm != "gno.land/r/c/d" || got[1].Height != 200 {
			t.Errorf("entry 1: got %+v", got[1])
		}
	})

	t.Run("malformed entry (no @) returns error and is skipped; valid entries still returned", func(t *testing.T) {
		got, errs := parseSeedCursorSpec("gno.land/r/a/b@100,no-at-sign,gno.land/r/c/d@200")
		if len(errs) != 1 {
			t.Errorf("expected 1 parse error, got %d: %v", len(errs), errs)
		}
		if len(got) != 2 {
			t.Fatalf("expected 2 valid entries, got %d", len(got))
		}
		if got[0].Realm != "gno.land/r/a/b" || got[0].Height != 100 {
			t.Errorf("entry 0: got %+v", got[0])
		}
		if got[1].Realm != "gno.land/r/c/d" || got[1].Height != 200 {
			t.Errorf("entry 1: got %+v", got[1])
		}
	})

	t.Run("non-integer height returns error for that entry and skips it", func(t *testing.T) {
		got, errs := parseSeedCursorSpec("gno.land/r/a/b@notanumber")
		if len(errs) != 1 {
			t.Errorf("expected 1 parse error, got %d: %v", len(errs), errs)
		}
		if len(got) != 0 {
			t.Errorf("expected empty valid slice, got %v", got)
		}
	})

	t.Run("empty realm returns error and is skipped", func(t *testing.T) {
		got, errs := parseSeedCursorSpec("@12345")
		if len(errs) != 1 {
			t.Errorf("expected 1 parse error, got %d: %v", len(errs), errs)
		}
		if len(got) != 0 {
			t.Errorf("expected empty valid slice for empty realm, got %v", got)
		}
	})

	t.Run("spaces around entries are trimmed", func(t *testing.T) {
		got, errs := parseSeedCursorSpec(" gno.land/r/a/b@100 , gno.land/r/c/d@200 ")
		if len(errs) != 0 {
			t.Fatalf("unexpected errors: %v", errs)
		}
		if len(got) != 2 {
			t.Fatalf("expected 2 entries after trim, got %d", len(got))
		}
		if got[0].Realm != "gno.land/r/a/b" || got[0].Height != 100 {
			t.Errorf("entry 0: got %+v", got[0])
		}
	})
}
