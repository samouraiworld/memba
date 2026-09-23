package service

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"slices"
	"testing"
)

// These tests pin the home snapshot to the chain the server serves. After a
// chain cutover the DB can still hold rows written against the old chain, and
// realms configured for the old chain may not exist on the new one; neither
// may leak into the snapshot.

// A cursor row for a realm the NFT tailer does not watch (e.g. a dead chain's
// realm, or any row surviving a cutover) must not drive indexer_last_block.
func TestMaxIndexerBlock_OnlyWatchedRealms(t *testing.T) {
	s := newTestService(t)
	s.SetNFTIndexedRealms([]string{"gno.land/r/new/market", "gno.land/r/new/collections"})
	if _, err := s.db.Exec(`INSERT INTO nft_indexer_state (realm_path, last_processed_block) VALUES
		('gno.land/r/new/market', 1200),
		('gno.land/r/new/collections', 1100),
		('gno.land/r/old/market', 757999)`); err != nil {
		t.Fatal(err)
	}
	b, err := s.maxIndexerBlock(context.Background())
	if err != nil || b != 1200 {
		t.Fatalf("got b=%d err=%v, want 1200 (the unwatched old-chain row must be ignored)", b, err)
	}
}

// With the NFT tailer off (NFT_INDEXER_DISABLED=1, the mainnet state) no
// indexer is running, so whatever the table holds is not this chain's
// progress: report 0 (omitted on the wire), not a leftover height.
func TestMaxIndexerBlock_NoIndexedRealmsReportsZero(t *testing.T) {
	s := newTestService(t)
	if _, err := s.db.Exec(`INSERT INTO nft_indexer_state (realm_path, last_processed_block) VALUES ('gno.land/r/old/market', 757999)`); err != nil {
		t.Fatal(err)
	}
	b, err := s.maxIndexerBlock(context.Background())
	if err != nil || b != 0 {
		t.Fatalf("got b=%d err=%v, want 0 while no NFT realm is indexed", b, err)
	}
}

// homeStatusServer serves /status at height head and a 3-validator set.
func homeStatusServer(t *testing.T, head int) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/status":
			_, _ = fmt.Fprintf(w, `{"result":{"sync_info":{"latest_block_height":"%d","latest_block_time":"2026-01-01T12:00:00Z"}}}`, head)
		case "/validators":
			_, _ = w.Write([]byte(`{"result":{"validators":[{},{},{}]}}`))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(srv.Close)
	return srv
}

// Even for a watched realm (realm paths are reused across chains), a cursor
// above the current chain head cannot belong to this chain. It is dropped and
// the source flagged stale instead of being served.
func TestAssembleHomeSnapshot_DropsIndexerCursorAboveChainHead(t *testing.T) {
	s := newTestService(t)
	s.homeQuery = func(rpc, path, data string) (string, error) { return "", fmt.Errorf("offline") }
	s.SetNFTIndexedRealms([]string{"gno.land/r/new/market"})
	if _, err := s.db.Exec(`INSERT INTO nft_indexer_state (realm_path, last_processed_block) VALUES ('gno.land/r/new/market', 757999)`); err != nil {
		t.Fatal(err)
	}
	srv := homeStatusServer(t, 272110)
	t.Setenv("RPC_FALLBACK_URLS", srv.URL)

	snap := s.assembleHomeSnapshot(context.Background(), srv.URL)

	if snap.AsOfBlock != 272110 {
		t.Fatalf("AsOfBlock = %d, want 272110", snap.AsOfBlock)
	}
	if snap.IndexerLastBlock != 0 {
		t.Fatalf("IndexerLastBlock = %d, want 0 (a cursor above the chain head is from another chain)", snap.IndexerLastBlock)
	}
	if !slices.Contains(snap.StaleSources, "indexer_block") {
		t.Fatalf("StaleSources = %v, want indexer_block flagged", snap.StaleSources)
	}
}

// A cursor at or below the head is served as-is.
func TestAssembleHomeSnapshot_KeepsIndexerCursorAtOrBelowHead(t *testing.T) {
	s := newTestService(t)
	s.homeQuery = func(rpc, path, data string) (string, error) { return "", fmt.Errorf("offline") }
	s.SetNFTIndexedRealms([]string{"gno.land/r/new/market"})
	if _, err := s.db.Exec(`INSERT INTO nft_indexer_state (realm_path, last_processed_block) VALUES ('gno.land/r/new/market', 272100)`); err != nil {
		t.Fatal(err)
	}
	srv := homeStatusServer(t, 272110)
	t.Setenv("RPC_FALLBACK_URLS", srv.URL)

	snap := s.assembleHomeSnapshot(context.Background(), srv.URL)

	if snap.IndexerLastBlock != 272100 {
		t.Fatalf("IndexerLastBlock = %d, want 272100", snap.IndexerLastBlock)
	}
	if slices.Contains(snap.StaleSources, "indexer_block") {
		t.Fatalf("StaleSources = %v, indexer_block must not be flagged", snap.StaleSources)
	}
}

// packageNotFoundRPC answers every abci_query the way gnoland-1 answers a
// vm/qrender for a package that is not deployed (response recorded 2026-09-23
// for gno.land/r/samcrew/memba_dao, Log trimmed).
func packageNotFoundRPC(t *testing.T) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"jsonrpc":"2.0","id":"","result":{"response":{"ResponseBase":{"Error":{"@type":"/vm.InvalidPkgPathError"},"Data":null,"Events":null,"Log":"package not found: gno.land/r/samcrew/memba_dao","Info":""},"Key":null,"Value":null,"Proof":null,"Height":"0"}}}`))
	}))
	t.Cleanup(srv.Close)
	return srv
}

// The configured featured DAO realm is not deployed on the current chain: the
// snapshot omits featured_dao rather than serving a nameless placeholder that
// points at a realm which does not exist.
func TestFetchFeaturedDao_AbsentRealmIsOmitted(t *testing.T) {
	var calls int
	s := &MultisigService{homeQuery: func(rpc, path, data string) (string, error) {
		calls++
		return "", nil // abciQuery's answer for "package not found"
	}}
	dao, err := s.fetchFeaturedDao(context.Background(), "ignored")
	if err != nil {
		t.Fatalf("absent realm is not a source failure, got err: %v", err)
	}
	if dao != nil {
		t.Fatalf("dao = %+v, want nil for an absent realm", dao)
	}
	if calls != 1 {
		t.Fatalf("homeQuery calls = %d, want 1 (no proposals/treasury reads for an absent realm)", calls)
	}
}

// End to end through the real abciQuery against the recorded not-found answer.
func TestAssembleHomeSnapshot_OmitsFeaturedDaoMissingOnChain(t *testing.T) {
	s := newTestService(t)
	rpc := packageNotFoundRPC(t)
	t.Setenv("RPC_FALLBACK_URLS", rpc.URL)

	dao, err := s.fetchFeaturedDao(context.Background(), rpc.URL)
	if err != nil || dao != nil {
		t.Fatalf("fetchFeaturedDao = (%+v, %v), want (nil, nil)", dao, err)
	}

	snap := s.assembleHomeSnapshot(context.Background(), rpc.URL)
	if snap.FeaturedDao != nil {
		t.Fatalf("FeaturedDao = %+v, want omitted", snap.FeaturedDao)
	}
	if slices.Contains(snap.StaleSources, "featured_dao") {
		t.Fatalf("StaleSources = %v: an absent realm is not a failed source", snap.StaleSources)
	}
}
