package service

import (
	"context"
	"os"
	"testing"
	"time"

	membav1 "github.com/samouraiworld/memba/backend/gen/memba/v1"
	"github.com/samouraiworld/memba/backend/internal/db"
)

// newTestService returns a *MultisigService backed by an in-memory SQLite DB
// (migrated) with the home-snapshot cache fields initialised. Mirror of setup()
// in service_test.go but returns the service directly instead of a testHarness.
func newTestService(t *testing.T) *MultisigService {
	t.Helper()
	database, err := db.Open(":memory:")
	if err != nil {
		t.Fatal("open db:", err)
	}
	if err := db.Migrate(database); err != nil {
		t.Fatal("migrate:", err)
	}
	t.Cleanup(func() {
		if err := database.Close(); err != nil {
			t.Errorf("failed to close database: %v", err)
		}
	})
	return &MultisigService{
		db:           database,
		homeCached:   make(map[string]*membav1.HomeSnapshot),
		homeCachedAt: make(map[string]time.Time),
		homeQuery:    abciQuery,
	}
}

func TestHomeSnapshotRPCURL_DefaultsToTest13(t *testing.T) {
	os.Unsetenv("HOME_SNAPSHOT_RPC_URL")
	os.Unsetenv("NFT_RPC_URL")
	if got := homeSnapshotRPCURL(); got != "https://rpc.test13.testnets.gno.land:443" {
		t.Fatalf("default = %q, want test13 rpc", got)
	}
}

func TestHomeSnapshotRPCURL_PrefersExplicitEnv(t *testing.T) {
	os.Setenv("HOME_SNAPSHOT_RPC_URL", "https://example/rpc")
	defer os.Unsetenv("HOME_SNAPSHOT_RPC_URL")
	if got := homeSnapshotRPCURL(); got != "https://example/rpc" {
		t.Fatalf("got %q, want explicit env", got)
	}
}

func TestHomeSnapshotTTL_Default(t *testing.T) {
	os.Unsetenv("HOME_SNAPSHOT_TTL")
	if got := homeSnapshotTTL(); got != 30*time.Second {
		t.Fatalf("default ttl = %v, want 30s", got)
	}
}

func TestCachedHomeSnapshot_MissThenHitThenStale(t *testing.T) {
	s := &MultisigService{
		homeCached:   make(map[string]*membav1.HomeSnapshot),
		homeCachedAt: make(map[string]time.Time),
	}
	calls := 0
	ok := func(ctx context.Context, rpc string) *membav1.HomeSnapshot {
		calls++
		return &membav1.HomeSnapshot{AsOfBlock: int64(calls)}
	}

	// MISS — assembles, caches.
	got := s.cachedHomeSnapshot(context.Background(), "test13", ok)
	if got.AsOfBlock != 1 || calls != 1 {
		t.Fatalf("miss: got block=%d calls=%d", got.AsOfBlock, calls)
	}
	// HIT — within TTL, no re-assembly.
	got = s.cachedHomeSnapshot(context.Background(), "test13", ok)
	if got.AsOfBlock != 1 || calls != 1 {
		t.Fatalf("hit: got block=%d calls=%d", got.AsOfBlock, calls)
	}
	// Force expiry, then a failing assemble → serve stale.
	s.homeCacheMu.Lock()
	s.homeCachedAt["test13"] = time.Now().Add(-time.Hour)
	s.homeCacheMu.Unlock()
	fail := func(ctx context.Context, rpc string) *membav1.HomeSnapshot { calls++; return nil }
	got = s.cachedHomeSnapshot(context.Background(), "test13", fail)
	if got == nil || got.AsOfBlock != 1 {
		t.Fatalf("stale: expected last-good block=1, got %+v", got)
	}
}

func TestCountCollections(t *testing.T) {
	s := newTestService(t)
	_, err := s.db.Exec(`INSERT INTO nft_collections (collection_id, name) VALUES ('a','A'),('b','B')`)
	if err != nil {
		t.Fatal(err)
	}
	n, err := s.countCollections(context.Background())
	if err != nil || n != 2 {
		t.Fatalf("got n=%d err=%v, want 2", n, err)
	}
}

func TestMaxIndexerBlock(t *testing.T) {
	s := newTestService(t)
	_, err := s.db.Exec(`INSERT INTO nft_indexer_state (realm_path, last_processed_block) VALUES ('r1', 100), ('r2', 250)`)
	if err != nil {
		t.Fatal(err)
	}
	b, err := s.maxIndexerBlock(context.Background())
	if err != nil || b != 250 {
		t.Fatalf("got b=%d err=%v, want 250", b, err)
	}
}
