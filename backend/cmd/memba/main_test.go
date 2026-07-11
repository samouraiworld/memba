package main

import (
	"maps"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"
)

// SEC-2: /metrics is gated by METRICS_BEARER when set. When unset it stays open
// OFF-Fly (dev convenience) but fails closed in prod (FLY_APP_NAME set), so a
// missing bearer can never silently expose the endpoint publicly.
func TestMetricsAuthMiddleware(t *testing.T) {
	ok := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })

	t.Run("unset env off-Fly leaves metrics open (dev convenience)", func(t *testing.T) {
		t.Setenv("METRICS_BEARER", "")
		t.Setenv("FLY_APP_NAME", "") // not on Fly
		rr := httptest.NewRecorder()
		metricsAuthMiddleware(ok).ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/metrics", nil))
		if rr.Code != http.StatusOK {
			t.Fatalf("unset off-Fly: want 200, got %d", rr.Code)
		}
	})

	t.Run("unset env on Fly fails closed", func(t *testing.T) {
		// Prod (FLY_APP_NAME set) must NOT serve metrics unauthenticated: a missing
		// bearer disables the endpoint rather than exposing it publicly.
		t.Setenv("METRICS_BEARER", "")
		t.Setenv("FLY_APP_NAME", "memba-backend")
		rr := httptest.NewRecorder()
		metricsAuthMiddleware(ok).ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/metrics", nil))
		if rr.Code != http.StatusServiceUnavailable {
			t.Fatalf("unset on Fly: want 503 (fail-closed), got %d", rr.Code)
		}
	})

	t.Run("set env requires the exact bearer token", func(t *testing.T) {
		t.Setenv("METRICS_BEARER", "s3cret")
		mw := metricsAuthMiddleware(ok)
		cases := []struct {
			name, header string
			want         int
		}{
			{"missing", "", http.StatusUnauthorized},
			{"wrong", "Bearer nope", http.StatusUnauthorized},
			{"correct", "Bearer s3cret", http.StatusOK},
		}
		for _, c := range cases {
			rr := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodGet, "/metrics", nil)
			if c.header != "" {
				req.Header.Set("Authorization", c.header)
			}
			mw.ServeHTTP(rr, req)
			if rr.Code != c.want {
				t.Errorf("%s: want %d, got %d", c.name, c.want, rr.Code)
			}
		}
	})
}

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

// W0.6: production boot guard. When FLY_APP_NAME is set the server must refuse to
// start on an unsafe config — unsigned auth enabled (impersonation-capable), or a
// missing METRICS_BEARER (/metrics would be public) / QUEST_ADMIN_ADDRESSES (would
// fall back to a baked-in admin). Off Fly (dev) none of these are enforced.
func TestValidateProductionConfig(t *testing.T) {
	base := map[string]string{
		"FLY_APP_NAME":              "memba-backend",
		"QUEST_ADMIN_ADDRESSES":     "g1admin",
		"METRICS_BEARER":            "s3cret",
		"MEMBA_ALLOW_UNSIGNED_AUTH": "",
	}
	getenv := func(over map[string]string) func(string) string {
		m := maps.Clone(base)
		maps.Copy(m, over)
		return func(k string) string { return m[k] }
	}
	has := func(errs []string, sub string) bool {
		for _, e := range errs {
			if strings.Contains(e, sub) {
				return true
			}
		}
		return false
	}

	// W0.6 is warnings-only — NEVER boot-blocking (a deliberate posture like the A2
	// Phase-1 unsigned-auth setting must not be able to brick prod).
	t.Run("not production: no warnings even when unsafe", func(t *testing.T) {
		warns := productionConfigWarnings(getenv(map[string]string{
			"FLY_APP_NAME": "", "QUEST_ADMIN_ADDRESSES": "", "METRICS_BEARER": "", "MEMBA_ALLOW_UNSIGNED_AUTH": "1",
		}))
		if len(warns) != 0 {
			t.Fatalf("non-prod should have no warnings, got %v", warns)
		}
	})
	t.Run("production, safe config: no warnings", func(t *testing.T) {
		if warns := productionConfigWarnings(getenv(nil)); len(warns) != 0 {
			t.Fatalf("safe prod config should have no warnings, got %v", warns)
		}
	})
	t.Run("production + unsigned auth enabled: warned (not fatal)", func(t *testing.T) {
		if warns := productionConfigWarnings(getenv(map[string]string{"MEMBA_ALLOW_UNSIGNED_AUTH": "1"})); !has(warns, "MEMBA_ALLOW_UNSIGNED_AUTH") {
			t.Fatalf("expected unsigned-auth warning, got %v", warns)
		}
	})
	t.Run("production + whitespace quest admin: warned", func(t *testing.T) {
		if warns := productionConfigWarnings(getenv(map[string]string{"QUEST_ADMIN_ADDRESSES": " "})); !has(warns, "QUEST_ADMIN_ADDRESSES") {
			t.Fatalf("expected quest-admin warning, got %v", warns)
		}
	})
	t.Run("production + truly-unset quest admin: warned", func(t *testing.T) {
		// Distinct from whitespace: the key is absent entirely (map returns "").
		env := getenv(nil)
		unset := func(k string) string {
			if k == "QUEST_ADMIN_ADDRESSES" {
				return ""
			}
			return env(k)
		}
		if warns := productionConfigWarnings(unset); !has(warns, "QUEST_ADMIN_ADDRESSES") {
			t.Fatalf("expected quest-admin warning for truly-unset key, got %v", warns)
		}
	})
	t.Run("production + missing metrics bearer: warned", func(t *testing.T) {
		if warns := productionConfigWarnings(getenv(map[string]string{"METRICS_BEARER": ""})); !has(warns, "METRICS_BEARER") {
			t.Fatalf("expected metrics-bearer warning, got %v", warns)
		}
	})
}

// Checkpoint ownership: the app self-checkpoints ONLY when Litestream does not
// manage the database. Anything but the exact "1" must fall back to
// self-checkpointing (the safe standalone default).
func TestLitestreamManaged(t *testing.T) {
	cases := map[string]bool{
		"1":    true,
		"":     false,
		"0":    false,
		"true": false,
		" 1":   false,
	}
	for val, want := range cases {
		got := litestreamManaged(func(k string) string {
			if k == "LITESTREAM_MANAGED" {
				return val
			}
			return ""
		})
		if got != want {
			t.Errorf("litestreamManaged(%q) = %v, want %v", val, got, want)
		}
	}
}

// The NFT tailer's default realm sets are an operator contract: a machine
// booted with NFT_WATCHED_REALMS / NFT_SALE_VOLUME_REALMS unset must index the
// engines that are actually live. The old default kept pointing at
// memba_nft_market_v3 (deauthorized 2026-06-27), so prod silently indexed a
// dead realm and missed every v3.1 sale until 2026-07-11. Changing these sets
// means changing this test AND backend/fly.toml [env] — deliberately.
func TestDefaultNFTTailerRealms(t *testing.T) {
	const (
		market     = "gno.land/r/samcrew/memba_nft_market_v2"
		collection = "gno.land/r/samcrew/memba_nft_v2"
		retiredV3  = "gno.land/r/samcrew/memba_nft_market_v3"
	)

	watched := splitOrigins(defaultNFTWatchedRealms(market, collection))
	wantWatched := []string{
		market,
		collection,
		"gno.land/r/samcrew/memba_nft_market_v3_1",
		"gno.land/r/samcrew/memba_nft_market_v3_2",
		// Launchpad registry: CollectionCreated / Mint / MintPublic /
		// MintAllowlist / RoyaltySet all come from this realm.
		"gno.land/r/samcrew/memba_collections",
	}
	if !slices.Equal(watched, wantWatched) {
		t.Errorf("default watched realms = %v, want %v", watched, wantWatched)
	}

	saleVolume := splitOrigins(defaultNFTSaleVolumeRealms())
	wantSaleVolume := []string{
		"gno.land/r/samcrew/memba_nft_market_v3_1",
		"gno.land/r/samcrew/memba_nft_market_v3_2",
	}
	if !slices.Equal(saleVolume, wantSaleVolume) {
		t.Errorf("default sale-volume realms = %v, want %v", saleVolume, wantSaleVolume)
	}

	// The retired engine must never re-enter either default.
	if slices.Contains(watched, retiredV3) || slices.Contains(saleVolume, retiredV3) {
		t.Errorf("retired realm %s must not appear in the default sets", retiredV3)
	}
}
