package service

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

// Guards the real Gno RPC wire format: the block hash lives under
// result.block_meta.block_id.hash (NOT a top-level result.block_id). The
// mocked-fetcher unit tests never exercised this parse, and reading the wrong
// path silently derived the daily seed from an empty hash.
func TestHttpBlockFetcher_ParsesRealWireFormat(t *testing.T) {
	const blockJSON = `{"result":{` +
		`"block_meta":{"block_id":{"hash":"KycxtlyWi5mYO3RoW2S8kC2BGxGa2bHAIT3Z02P0FPM="},` +
		`"header":{"time":"2026-07-06T00:00:02.954715225Z"}},` +
		`"block":{"header":{"time":"2026-07-06T00:00:02.954715225Z"}}}}`
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/status":
			_, _ = w.Write([]byte(`{"result":{"sync_info":{"latest_block_height":"663436"}}}`))
		case "/block":
			_, _ = w.Write([]byte(blockJSON))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer srv.Close()

	f := httpBlockFetcher{rpcURL: srv.URL}

	h, err := f.LatestHeight(context.Background())
	if err != nil || h != 663436 {
		t.Fatalf("LatestHeight = %d, err = %v; want 663436", h, err)
	}
	bi, err := f.BlockAt(context.Background(), 663436)
	if err != nil {
		t.Fatalf("BlockAt: %v", err)
	}
	if bi.Hash != "KycxtlyWi5mYO3RoW2S8kC2BGxGa2bHAIT3Z02P0FPM=" {
		t.Fatalf("hash = %q (empty means the block_meta parse regressed)", bi.Hash)
	}
	if bi.Time.IsZero() {
		t.Fatal("block time did not parse")
	}
}

// A response with no block_id.hash in either location must FAIL LOUD, never
// return an empty hash that would derive a bogus seed.
func TestHttpBlockFetcher_EmptyHashFailsLoud(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"result":{"block":{"header":{"time":"2026-07-06T00:00:02Z"}}}}`))
	}))
	defer srv.Close()

	f := httpBlockFetcher{rpcURL: srv.URL}
	if _, err := f.BlockAt(context.Background(), 1); err == nil {
		t.Fatal("expected an error when block_id.hash is absent, got nil")
	}
}
