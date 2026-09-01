package service

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// Wire fixtures captured from the LIVE pearl node (rpc.pearl.testnets.gno.land,
// 2026-09-01): /status carries result.node_info.network and /block carries the
// chain id in BOTH result.block_meta.header.chain_id and
// result.block.header.chain_id. The hash lives under
// result.block_meta.block_id.hash (NOT a top-level result.block_id).
const (
	pearlStatusJSON = `{"result":{` +
		`"node_info":{"network":"pearl-1"},` +
		`"sync_info":{"latest_block_height":"118577"}}}`
	pearlBlockJSON = `{"result":{` +
		`"block_meta":{"block_id":{"hash":"s0leQ+7nRr7v1Aj2YwZPZR4IC5qNWCxL03SPxcDpfPo="},` +
		`"header":{"chain_id":"pearl-1","time":"2026-08-27T14:00:02.954715225Z"}},` +
		`"block":{"header":{"chain_id":"pearl-1","time":"2026-08-27T14:00:02.954715225Z"}}}}`
)

func pearlServer(t *testing.T) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/status":
			_, _ = w.Write([]byte(pearlStatusJSON))
		case "/block":
			_, _ = w.Write([]byte(pearlBlockJSON))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(srv.Close)
	return srv
}

// Guards the real Gno RPC wire format end to end, chain identity included.
func TestHttpBlockFetcher_ParsesRealWireFormat(t *testing.T) {
	srv := pearlServer(t)
	f := httpBlockFetcher{rpcURL: srv.URL, expectChainID: "pearl-1"}

	h, err := f.LatestHeight(context.Background())
	if err != nil || h != 118577 {
		t.Fatalf("LatestHeight = %d, err = %v; want 118577", h, err)
	}
	bi, err := f.BlockAt(context.Background(), 118577)
	if err != nil {
		t.Fatalf("BlockAt: %v", err)
	}
	if bi.Hash != "s0leQ+7nRr7v1Aj2YwZPZR4IC5qNWCxL03SPxcDpfPo=" {
		t.Fatalf("hash = %q (empty means the block_meta parse regressed)", bi.Hash)
	}
	if bi.Time.IsZero() {
		t.Fatal("block time did not parse")
	}
}

// A node answering with the WRONG chain id must be refused on /status. An RPC
// that answers is not the chain you asked for — DNS and HTTP 200 are false
// positives (the sapphire sentry hostname served pearl; pre-genesis pearl
// infra served a frozen sapphire).
func TestHttpBlockFetcher_RejectsWrongChain(t *testing.T) {
	srv := pearlServer(t)
	f := httpBlockFetcher{rpcURL: srv.URL, expectChainID: "sapphire-1"}
	_, err := f.LatestHeight(context.Background())
	if err == nil {
		t.Fatal("expected a chain-mismatch error, got nil")
	}
	if !strings.Contains(err.Error(), `"pearl-1"`) || !strings.Contains(err.Error(), `"sapphire-1"`) {
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
	f := httpBlockFetcher{rpcURL: srv.URL, expectChainID: "pearl-1"}
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
			_, _ = w.Write([]byte(pearlStatusJSON))
		case "/block":
			_, _ = w.Write([]byte(strings.ReplaceAll(pearlBlockJSON, "pearl-1", "sapphire-1")))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer srv.Close()
	f := httpBlockFetcher{rpcURL: srv.URL, expectChainID: "pearl-1"}
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
	healthy := pearlServer(t)
	t.Setenv("RPC_FALLBACK_URLS", healthy.URL)
	// A closed port: reserve one with a listener, close it, use its address.
	dead := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	deadURL := dead.URL
	dead.Close()

	f := httpBlockFetcher{rpcURL: deadURL, expectChainID: "pearl-1"}
	if _, err := f.LatestHeight(context.Background()); err == nil {
		t.Fatal("expected an error from the dead configured node; success means seeding failed over")
	}
}

// A fetcher constructed without an expected chain id must refuse to run at
// all — fail-closed beats silently unverified.
func TestHttpBlockFetcher_EmptyExpectationFailsClosed(t *testing.T) {
	srv := pearlServer(t)
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
		_, _ = w.Write([]byte(`{"result":{"block":{"header":{"chain_id":"pearl-1","time":"2026-07-06T00:00:02Z"}}}}`))
	}))
	defer srv.Close()

	f := httpBlockFetcher{rpcURL: srv.URL, expectChainID: "pearl-1"}
	if _, err := f.BlockAt(context.Background(), 1); err == nil {
		t.Fatal("expected an error when block_id.hash is absent, got nil")
	}
}

// The built-in defaults must name the live chain AND its identity — the named
// regression this file exists for: the seed default silently pointed at
// sapphire (which sunsets 2026-09-09) while the secret pointed at dead test13.
func TestBlockPartyFetcher_DefaultsToPearl(t *testing.T) {
	s := &MultisigService{}
	f := s.blockPartyFetcher()
	if f.rpcURL != "https://rpc.pearl.samourai.live:443" {
		t.Fatalf("default seed RPC = %q; want the pearl sentry", f.rpcURL)
	}
	if f.expectChainID != "pearl-1" {
		t.Fatalf("default expected chain = %q; want pearl-1", f.expectChainID)
	}
}
