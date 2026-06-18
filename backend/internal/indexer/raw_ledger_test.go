package indexer

import (
	"context"
	"encoding/json"
	"testing"
)

func TestRecordRawEvent_StoresFullAttrsIdempotently(t *testing.T) {
	db := openTestDB(t)
	ctx := context.Background()

	e := ev("Sale", "gno.land/r/samcrew/memba_nft_market_v3", 500, 1, 2, map[string]string{
		"via": "buy", "collection": "genesis", "tokenId": "7",
		"royaltyRecipient": "g1roy", "denom": "ugnot", "schemaVersion": "1",
	})
	must(t, recordRawEvent(ctx, db, e, "HASH500"))
	must(t, recordRawEvent(ctx, db, e, "HASH500")) // replay = no-op

	if n := countRows(t, db, `SELECT COUNT(*) FROM nft_raw_events`); n != 1 {
		t.Fatalf("raw rows = %d, want 1 (idempotent)", n)
	}
	var pkg, name, sv, attrs, hash string
	must(t, db.QueryRow(`SELECT pkg_path, event_name, schema_version, attrs_json, block_hash FROM nft_raw_events`).
		Scan(&pkg, &name, &sv, &attrs, &hash))
	if pkg != "gno.land/r/samcrew/memba_nft_market_v3" || name != "Sale" || sv != "1" || hash != "HASH500" {
		t.Errorf("row = %q %q %q %q", pkg, name, sv, hash)
	}
	var m map[string]string
	if err := json.Unmarshal([]byte(attrs), &m); err != nil {
		t.Fatalf("attrs_json not valid JSON: %v", err)
	}
	if m["royaltyRecipient"] != "g1roy" || m["via"] != "buy" {
		t.Errorf("attrs lost fields: %v", m)
	}
}
