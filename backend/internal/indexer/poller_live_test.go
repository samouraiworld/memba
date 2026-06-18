package indexer

import (
	"os"
	"strings"
	"testing"
)

// Live RPC check against gno.land test13, gated behind MEMBA_LIVE_RPC so CI
// stays hermetic. Run with:
//
//	MEMBA_LIVE_RPC=1 go test ./internal/indexer/ -run Live -v
//
// Proves the poller's queryRender base64-encodes the `data` param (gno.land
// rejects raw bytes) and uses the "<pkgpath>:<path>" colon syntax.
func TestLive_QueryRender_ReturnsData(t *testing.T) {
	if os.Getenv("MEMBA_LIVE_RPC") == "" {
		t.Skip("set MEMBA_LIVE_RPC=1 to run live test13 RPC checks")
	}
	const rpc = "https://rpc.test13.testnets.gno.land:443"
	out, err := queryRender(rpc, "gno.land/r/samcrew/memba_dao:")
	if err != nil {
		t.Fatalf("queryRender failed: %v", err)
	}
	if !strings.Contains(out, "MembaDAO") {
		t.Fatalf("expected MembaDAO render, got %q", out)
	}
}
