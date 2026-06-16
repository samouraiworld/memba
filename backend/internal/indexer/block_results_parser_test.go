package indexer

import (
	"os"
	"path/filepath"
	"testing"
)

func loadFixture(t *testing.T, name string) []byte {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("testdata", name))
	if err != nil {
		t.Fatalf("read fixture %s: %v", name, err)
	}
	return b
}

func TestParseBlockResults_Sample(t *testing.T) {
	body := loadFixture(t, "sample_block_results.json")
	events, err := parseBlockResults(body, 263900)
	if err != nil {
		t.Fatal("parseBlockResults:", err)
	}
	// tx0: NFTListed; tx1: MarketTransfer + PurchaseConfirmed = 3 watched events.
	if len(events) != 3 {
		t.Fatalf("expected 3 events, got %d: %+v", len(events), events)
	}

	listed := events[0]
	if listed.Type != "NFTListed" {
		t.Errorf("event[0].Type = %q, want NFTListed", listed.Type)
	}
	if listed.PkgPath != "gno.land/r/samcrew/memba_nft_market_v2" {
		t.Errorf("event[0].PkgPath = %q", listed.PkgPath)
	}
	if listed.TxIndex != 0 || listed.EventIdx != 0 || listed.Block != 263900 {
		t.Errorf("event[0] position = tx%d ev%d block%d", listed.TxIndex, listed.EventIdx, listed.Block)
	}
	if got := listed.Attr("collection"); got != "genesis" {
		t.Errorf("collection = %q", got)
	}
	if got := listed.Attr("price"); got != "1500000" {
		t.Errorf("price = %q", got)
	}
	if got := listed.Attr("seller"); got != "g1seller00000000000000000000000000000abc" {
		t.Errorf("seller = %q (must be full untruncated)", got)
	}

	transfer := events[1]
	if transfer.Type != "MarketTransfer" || transfer.TxIndex != 1 || transfer.EventIdx != 0 {
		t.Errorf("event[1] = %q tx%d ev%d", transfer.Type, transfer.TxIndex, transfer.EventIdx)
	}

	purchase := events[2]
	if purchase.Type != "PurchaseConfirmed" || purchase.TxIndex != 1 || purchase.EventIdx != 1 {
		t.Errorf("event[2] = %q tx%d ev%d", purchase.Type, purchase.TxIndex, purchase.EventIdx)
	}
	if purchase.Attr("royalty") != "75000" || purchase.Attr("fee") != "37500" {
		t.Errorf("purchase fee/royalty = %q/%q", purchase.Attr("fee"), purchase.Attr("royalty"))
	}
}

func TestParseBlockResults_EmptyBlock(t *testing.T) {
	body := loadFixture(t, "empty_block_results.json")
	events, err := parseBlockResults(body, 100)
	if err != nil {
		t.Fatal("parseBlockResults:", err)
	}
	if len(events) != 0 {
		t.Fatalf("expected 0 events for empty block, got %d", len(events))
	}
}

func TestParseBlockResults_Malformed(t *testing.T) {
	if _, err := parseBlockResults([]byte("{not json"), 1); err == nil {
		t.Fatal("expected error for malformed JSON")
	}
}

func TestParseBlockResults_RPCError(t *testing.T) {
	body := []byte(`{"error":{"message":"height not available"}}`)
	if _, err := parseBlockResults(body, 1); err == nil {
		t.Fatal("expected error for rpc-level error")
	}
}
