package service

import (
	"context"
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
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

func TestFetchNetworkPulse_FromFixture(t *testing.T) {
	body, err := os.ReadFile("testdata/home/status.json")
	if err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/status" {
			w.Write(body)
			return
		}
		w.WriteHeader(404)
	}))
	defer srv.Close()
	p, err := fetchNetworkPulse(context.Background(), srv.URL)
	if err != nil {
		t.Fatal(err)
	}
	if p.BlockHeight <= 0 {
		t.Fatalf("block height not parsed: %d", p.BlockHeight)
	}
}

func TestFetchValidatorsHealth_FromFixture(t *testing.T) {
	body, err := os.ReadFile("testdata/home/validators.json")
	if err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/validators" {
			w.Write(body)
			return
		}
		w.WriteHeader(404)
	}))
	defer srv.Close()
	v, err := fetchValidatorsHealth(context.Background(), srv.URL)
	if err != nil {
		t.Fatal(err)
	}
	if v.Total == 0 || v.Status == "" {
		t.Fatalf("validators not parsed: %+v", v)
	}
}

// ── Token count tests ────────────────────────────────────────────────────────

// TestCountTokens_FromFixture asserts the parser handles the real captured render
// (currently 0 tokens on test13).
func TestCountTokens_FromFixture(t *testing.T) {
	raw, err := os.ReadFile("testdata/home/tokens_render.txt")
	if err != nil {
		t.Fatal(err)
	}
	s := &MultisigService{
		homeQuery: func(rpc, path, data string) (string, error) { return string(raw), nil },
	}
	n, err := s.countTokens(context.Background(), "ignored")
	if err != nil {
		t.Fatal(err)
	}
	// Live fixture: "# Samcrew Token Factory (0 tokens)"
	if n != 0 {
		t.Fatalf("token count from fixture = %d, want 0", n)
	}
}

// TestCountTokens_Synthetic asserts the parser extracts a non-zero count so we
// prove it can actually count, not just return 0 on every input.
func TestCountTokens_Synthetic(t *testing.T) {
	synthetic := "# Samcrew Token Factory (3 tokens)\n\n*Platform fee: 2.5%*\n"
	s := &MultisigService{
		homeQuery: func(rpc, path, data string) (string, error) { return synthetic, nil },
	}
	n, err := s.countTokens(context.Background(), "ignored")
	if err != nil {
		t.Fatal(err)
	}
	if n != 3 {
		t.Fatalf("token count from synthetic = %d, want 3", n)
	}
}

// ── Agent count tests ────────────────────────────────────────────────────────

// TestCountAgents_FromFixture asserts the parser handles the real captured render
// (currently 0 agents on test13).
func TestCountAgents_FromFixture(t *testing.T) {
	raw, err := os.ReadFile("testdata/home/agents_render.txt")
	if err != nil {
		t.Fatal(err)
	}
	s := &MultisigService{
		homeQuery: func(rpc, path, data string) (string, error) { return string(raw), nil },
	}
	n, err := s.countAgents(context.Background(), "ignored")
	if err != nil {
		t.Fatal(err)
	}
	// Live fixture: "*No agents registered yet.*" → 0 rows
	if n != 0 {
		t.Fatalf("agent count from fixture = %d, want 0", n)
	}
}

// TestCountAgents_Synthetic asserts the parser counts real table rows, mirroring
// the frontend parseAgentTable logic in frontend/src/lib/agentRegistry.ts:158.
func TestCountAgents_Synthetic(t *testing.T) {
	// Two-row agent table matching the format documented in parseAgentTable's JSDoc.
	synthetic := `# Memba Agent Registry

On-chain AI Agent Marketplace for the Gno ecosystem.

| ID | Name | Category | Rating | Pricing |
| --- | --- | --- | --- | --- |
| memba-mcp | [Memba MCP Server](:agent/memba-mcp) | development | 5.0 (1) | free |
| helper-bot | [Helper Bot](:agent/helper-bot) | utility | unrated | free |
`
	s := &MultisigService{
		homeQuery: func(rpc, path, data string) (string, error) { return synthetic, nil },
	}
	n, err := s.countAgents(context.Background(), "ignored")
	if err != nil {
		t.Fatal(err)
	}
	if n != 2 {
		t.Fatalf("agent count from synthetic = %d, want 2", n)
	}
}

// ── Featured DAO tests ────────────────────────────────────────────────────────

// TestFetchFeaturedDao_FromFixture verifies parsing the live-captured render.
// Name must be "MembaDAO"; proposals fixture has 0 open proposals.
func TestFetchFeaturedDao_FromFixture(t *testing.T) {
	bareRaw, err := os.ReadFile("testdata/home/featured_dao_render.txt")
	if err != nil {
		t.Fatal(err)
	}
	proposalsRaw, err := os.ReadFile("testdata/home/featured_dao_proposals_render.txt")
	if err != nil {
		t.Fatal(err)
	}

	s := &MultisigService{
		homeQuery: func(rpc, path, data string) (string, error) {
			// Decode the base64 data to distinguish bare render from proposals page.
			decoded, _ := base64.StdEncoding.DecodeString(data)
			if strings.HasSuffix(string(decoded), ":proposals") {
				return string(proposalsRaw), nil
			}
			// bare render ends with ":" (and bank/balances path won't have a ":"
			// suffix in data, so this also handles the treasury best-effort call)
			return string(bareRaw), nil
		},
	}

	dao, err := s.fetchFeaturedDao(context.Background(), "ignored")
	if err != nil {
		t.Fatal(err)
	}
	if dao == nil {
		t.Fatal("expected non-nil FeaturedDao")
	}
	if dao.Name != "MembaDAO" {
		t.Fatalf("Name = %q, want MembaDAO", dao.Name)
	}
	if dao.RealmPath == "" {
		t.Fatal("RealmPath should not be empty")
	}
	if dao.OpenProposals != 0 {
		t.Fatalf("OpenProposals = %d, want 0 (live fixture has 0 active proposals)", dao.OpenProposals)
	}
}

// TestFetchFeaturedDao_SyntheticProposals verifies open-proposal counting + title extraction.
// Uses 2 ACTIVE proposals in synthetic markdown.
func TestFetchFeaturedDao_SyntheticProposals(t *testing.T) {
	bare := "# SyntheticDAO\n\n> Realm address: g1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n"
	proposals := `# SyntheticDAO - Proposals

## Active Proposals (2)

### [Prop #2 - Upgrade treasury](link)
Author: [@alice](profile)
Status: ACTIVE
Tiers eligible to vote: T1, T2

### [Prop #1 - Onboard new member](link)
Author: [@bob](profile)
Status: ACTIVE
Tiers eligible to vote: T1
`

	// Fake homeQuery: returns bare render when data contains ":" suffix (base64 'd...Og==')
	// and proposals render for all other calls.
	callCount := 0
	s := &MultisigService{
		homeQuery: func(rpc, path, data string) (string, error) {
			callCount++
			if callCount == 1 {
				return bare, nil
			}
			return proposals, nil
		},
	}

	dao, err := s.fetchFeaturedDao(context.Background(), "ignored")
	if err != nil {
		t.Fatal(err)
	}
	if dao.Name != "SyntheticDAO" {
		t.Fatalf("Name = %q, want SyntheticDAO", dao.Name)
	}
	if dao.OpenProposals != 2 {
		t.Fatalf("OpenProposals = %d, want 2", dao.OpenProposals)
	}
	if dao.LatestProposalTitle != "Upgrade treasury" {
		t.Fatalf("LatestProposalTitle = %q, want 'Upgrade treasury'", dao.LatestProposalTitle)
	}
}

// ── Directory members tests ──────────────────────────────────────────────────

// TestFetchDirectoryMembers_FromFixture verifies the stats-only live fixture yields [].
func TestFetchDirectoryMembers_FromFixture(t *testing.T) {
	raw, err := os.ReadFile("testdata/home/registry_render.txt")
	if err != nil {
		t.Fatal(err)
	}
	s := &MultisigService{
		homeQuery: func(rpc, path, data string) (string, error) { return string(raw), nil },
	}
	members, err := s.fetchDirectoryMembers(context.Background(), "ignored", 4)
	if err != nil {
		t.Fatal(err)
	}
	if len(members) != 0 {
		t.Fatalf("expected 0 members from stats-only fixture, got %d", len(members))
	}
}

// TestFetchDirectoryMembers_Synthetic verifies the parser can extract entries
// from a populated registry render matching parseUserRegistry's expected format.
func TestFetchDirectoryMembers_Synthetic(t *testing.T) {
	// Mirrors the two line formats from frontend/src/lib/directory.ts:parseUserRegistry
	synthetic := `# r/sys/users

## Members

* [alice](/u/alice) - g1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1
* bob g1bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb2
`
	s := &MultisigService{
		homeQuery: func(rpc, path, data string) (string, error) { return synthetic, nil },
	}
	members, err := s.fetchDirectoryMembers(context.Background(), "ignored", 4)
	if err != nil {
		t.Fatal(err)
	}
	if len(members) != 2 {
		t.Fatalf("expected 2 members, got %d", len(members))
	}
	if members[0].Name != "alice" {
		t.Fatalf("member[0].Name = %q, want alice", members[0].Name)
	}
	if members[0].Address != "g1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1" {
		t.Fatalf("member[0].Address = %q", members[0].Address)
	}
	if members[1].Name != "bob" {
		t.Fatalf("member[1].Name = %q, want bob", members[1].Name)
	}
}

// TestFetchDirectoryMembers_Limit verifies the limit parameter truncates the list.
func TestFetchDirectoryMembers_Limit(t *testing.T) {
	synthetic := `# r/sys/users

* [alice](/u/alice) - g1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1
* [bob](/u/bob) - g1bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb2
* [carol](/u/carol) - g1cccccccccccccccccccccccccccccccccccc3
* [dave](/u/dave) - g1dddddddddddddddddddddddddddddddddddd4
* [eve](/u/eve) - g1eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee5
`
	s := &MultisigService{
		homeQuery: func(rpc, path, data string) (string, error) { return synthetic, nil },
	}
	members, err := s.fetchDirectoryMembers(context.Background(), "ignored", 3)
	if err != nil {
		t.Fatal(err)
	}
	if len(members) != 3 {
		t.Fatalf("expected 3 members after limit, got %d", len(members))
	}
}
