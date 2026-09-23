package service

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// Wire fixtures captured from the LIVE gnoland-1 sentry (rpc.mainnet.samourai.live,
// 2026-09-23, block 265293): /status carries result.node_info.network and /block carries the
// chain id in BOTH result.block_meta.header.chain_id and
// result.block.header.chain_id. The hash lives under
// result.block_meta.block_id.hash (NOT a top-level result.block_id).
const (
	mainnetStatusJSON = `{"result":{` +
		`"node_info":{"network":"gnoland-1"},` +
		`"sync_info":{"latest_block_height":"267415"}}}`
	mainnetBlockJSON = `{"result":{` +
		`"block_meta":{"block_id":{"hash":"4GwS+Y2X6L4phInt2IcMCUdqGCEshlORaOo3pnW8ddg="},` +
		`"header":{"chain_id":"gnoland-1","time":"2026-09-23T09:22:56.735560753Z"}},` +
		`"block":{"header":{"chain_id":"gnoland-1","time":"2026-09-23T09:22:56.735560753Z"}}}}`
)

func mainnetServer(t *testing.T) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/status":
			_, _ = w.Write([]byte(mainnetStatusJSON))
		case "/block":
			_, _ = w.Write([]byte(mainnetBlockJSON))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(srv.Close)
	return srv
}

// Guards the real Gno RPC wire format end to end, chain identity included.
func TestHttpBlockFetcher_ParsesRealWireFormat(t *testing.T) {
	srv := mainnetServer(t)
	f := httpBlockFetcher{rpcURL: srv.URL, expectChainID: "gnoland-1"}

	h, err := f.LatestHeight(context.Background())
	if err != nil || h != 267415 {
		t.Fatalf("LatestHeight = %d, err = %v; want 267415", h, err)
	}
	bi, err := f.BlockAt(context.Background(), 265293)
	if err != nil {
		t.Fatalf("BlockAt: %v", err)
	}
	if bi.Hash != "4GwS+Y2X6L4phInt2IcMCUdqGCEshlORaOo3pnW8ddg=" {
		t.Fatalf("hash = %q (empty means the block_meta parse regressed)", bi.Hash)
	}
	if bi.Time.IsZero() {
		t.Fatal("block time did not parse")
	}
}

// A node answering with the WRONG chain id must be refused on /status. An RPC
// that answers is not the chain you asked for — DNS and HTTP 200 are false
// positives (retired testnet sentry hostnames have served other chains, and
// betanet "gnoland1" differs from mainnet "gnoland-1" by one hyphen).
func TestHttpBlockFetcher_RejectsWrongChain(t *testing.T) {
	srv := mainnetServer(t)
	f := httpBlockFetcher{rpcURL: srv.URL, expectChainID: "gnoland1"}
	_, err := f.LatestHeight(context.Background())
	if err == nil {
		t.Fatal("expected a chain-mismatch error, got nil")
	}
	if !strings.Contains(err.Error(), `"gnoland-1"`) || !strings.Contains(err.Error(), `"gnoland1"`) {
		t.Fatalf("mismatch error must name got and want chains, got: %v", err)
	}
}

// A /status with no node_info.network must FAIL LOUD — absence of proof is not
// proof of the right chain.
func TestHttpBlockFetcher_MissingNetworkFailsLoud(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"result":{"sync_info":{"latest_block_height":"42"}}}`))
	}))
	defer srv.Close()
	f := httpBlockFetcher{rpcURL: srv.URL, expectChainID: "gnoland-1"}
	if _, err := f.LatestHeight(context.Background()); err == nil {
		t.Fatal("expected an error when node_info.network is absent, got nil")
	}
}

// /status can pass while a later /block is served by a different backend
// behind the same load balancer — the per-block header check closes that hole.
func TestHttpBlockFetcher_RejectsWrongChainBlockHeader(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/status":
			_, _ = w.Write([]byte(mainnetStatusJSON))
		case "/block":
			_, _ = w.Write([]byte(strings.ReplaceAll(mainnetBlockJSON, `"gnoland-1"`, `"gnoland1"`)))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer srv.Close()
	f := httpBlockFetcher{rpcURL: srv.URL, expectChainID: "gnoland-1"}
	if _, err := f.LatestHeight(context.Background()); err != nil {
		t.Fatalf("status leg should pass: %v", err)
	}
	if _, err := f.BlockAt(context.Background(), 1); err == nil {
		t.Fatal("expected a chain-mismatch error from the block header check, got nil")
	}
}

// Seeding must NOT fail over to other nodes: a wrong seed is permanent
// (PutChallenge is INSERT OR IGNORE), so a dead configured node must surface
// as an ERROR even when RPC_FALLBACK_URLS names a healthy one. This pins the
// single-node semantics forever — reintroducing httpGetJSONResilient here
// turns this test red.
func TestHttpBlockFetcher_NoFailoverForSeeding(t *testing.T) {
	healthy := mainnetServer(t)
	t.Setenv("RPC_FALLBACK_URLS", healthy.URL)
	// A closed port: reserve one with a listener, close it, use its address.
	dead := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	deadURL := dead.URL
	dead.Close()

	f := httpBlockFetcher{rpcURL: deadURL, expectChainID: "gnoland-1"}
	if _, err := f.LatestHeight(context.Background()); err == nil {
		t.Fatal("expected an error from the dead configured node; success means seeding failed over")
	}
}

// A fetcher constructed without an expected chain id must refuse to run at
// all — fail-closed beats silently unverified.
func TestHttpBlockFetcher_EmptyExpectationFailsClosed(t *testing.T) {
	srv := mainnetServer(t)
	f := httpBlockFetcher{rpcURL: srv.URL}
	if _, err := f.LatestHeight(context.Background()); err == nil {
		t.Fatal("expected fail-closed error for empty expectChainID (LatestHeight)")
	}
	if _, err := f.BlockAt(context.Background(), 1); err == nil {
		t.Fatal("expected fail-closed error for empty expectChainID (BlockAt)")
	}
}

// A response with no block_id.hash in either location must FAIL LOUD, never
// return an empty hash that would derive a bogus seed.
func TestHttpBlockFetcher_EmptyHashFailsLoud(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"result":{"block":{"header":{"chain_id":"gnoland-1","time":"2026-09-23T00:00:02Z"}}}}`))
	}))
	defer srv.Close()

	f := httpBlockFetcher{rpcURL: srv.URL, expectChainID: "gnoland-1"}
	if _, err := f.BlockAt(context.Background(), 1); err == nil {
		t.Fatal("expected an error when block_id.hash is absent, got nil")
	}
}

// The built-in defaults must name the live chain AND its identity — the named
// regression this file exists for: the seed default silently pointed at a
// retired testnet while the secret pointed at another dead one.
func TestBlockPartyFetcher_DefaultsToMainnet(t *testing.T) {
	s := &MultisigService{}
	f := s.blockPartyFetcher()
	if f.rpcURL != "https://rpc.mainnet.samourai.live:443" {
		t.Fatalf("default seed RPC = %q; want the gnoland-1 sentry", f.rpcURL)
	}
	if f.expectChainID != "gnoland-1" {
		t.Fatalf("default expected chain = %q; want gnoland-1", f.expectChainID)
	}
}
