package indexer

import (
	"testing"
	"time"
)

// parseBlockTime must extract the block header time (deterministic, denormalized
// at ingest) from a real test13 /block body — NOT the non-deterministic ingest
// wall-clock. Guards the JSON path against a tm2 shape change.
func TestParseBlockTime_RealTest13Block(t *testing.T) {
	body := loadFixture(t, "block_260001.json")
	ts, err := parseBlockTime(body, 260001)
	if err != nil {
		t.Fatalf("parseBlockTime on a real /block body must succeed, got: %v", err)
	}
	want, _ := time.Parse(time.RFC3339, "2026-06-16T19:32:17.211442967Z")
	if ts != want.Unix() {
		t.Fatalf("block_ts: got %d, want %d (header.time → unix seconds)", ts, want.Unix())
	}
}

// A body without a header time is an error, not a silent 0 — the caller logs and
// retries the block rather than persisting a wrong timestamp.
func TestParseBlockTime_MissingTimeIsError(t *testing.T) {
	if _, err := parseBlockTime([]byte(`{"result":{"block_meta":{"header":{}}}}`), 42); err == nil {
		t.Fatal("expected an error when header.time is absent")
	}
}
