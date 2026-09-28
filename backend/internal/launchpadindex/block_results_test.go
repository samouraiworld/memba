package launchpadindex

import (
	"encoding/json"
	"errors"
	"os"
	"strings"
	"testing"
)

func blockBody(t *testing.T, height string, txs ...any) []byte {
	t.Helper()
	body, err := json.Marshal(map[string]any{
		"result": map[string]any{
			"height":  height,
			"results": map[string]any{"deliver_tx": txs},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	return body
}

func blockTx(status any, events ...any) map[string]any {
	return map[string]any{"ResponseBase": map[string]any{"Error": status, "Events": events}}
}

func blockEvent(path, eventType string, attrs []Attribute) map[string]any {
	return map[string]any{"pkg_path": path, "type": eventType, "attrs": attrs}
}

func TestParseBlockResultsPositionsAndFailedTx(t *testing.T) {
	valid := blockEvent(TokenRealmPath, TokenCreatedType, validEvent(t, "T1"))
	spoof := blockEvent(TokenRealmPath+"-evil", TokenCreatedType, validEvent(t, "T1"))
	body := blockBody(t, "42",
		blockTx(nil, spoof, blockEvent(TokenRealmPath, "OtherEvent", nil)),
		blockTx(map[string]any{"Code": 1}, valid),
		blockTx(nil, blockEvent("gno.land/r/other", "OtherEvent", nil), valid),
	)
	got, err := ParseBlockResults(body, 42)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0].ID != "T1" || got[0].BlockHeight != 42 || got[0].TxIndex != 2 || got[0].EventIndex != 1 {
		t.Fatalf("wrong validated event coordinates: %+v", got)
	}
	if len(got[0].RawAttributes) != 7 || got[0].RawAttributes[0].Key != "id" ||
		got[0].RawAttributes[6].Key != "currency_key" {
		t.Fatalf("raw event attributes lost or reordered: %+v", got[0].RawAttributes)
	}
	got, err = ParseBlockResults(blockBody(t, "43"), 43)
	if err != nil || len(got) != 0 {
		t.Fatalf("empty block: %+v, %v", got, err)
	}
}

func TestParseBlockResultsExistingRPCFixture(t *testing.T) {
	body, err := os.ReadFile("../indexer/testdata/sample_block_results.json")
	if err != nil {
		t.Fatal(err)
	}
	got, err := ParseBlockResults(body, 263900)
	if err != nil || len(got) != 0 {
		t.Fatalf("existing /block_results fixture: %+v, %v", got, err)
	}
}

func TestParseBlockResultsFailsClosed(t *testing.T) {
	valid := validEvent(t, "T1")
	bad := append([]Attribute(nil), valid...)
	bad[6] = Attribute{Key: "id", Value: "T1"}
	for _, tc := range []struct {
		name string
		body []byte
		want string
	}{
		{"wrong height", blockBody(t, "43"), "height mismatch"},
		{"noncanonical height", blockBody(t, "042"), "height mismatch"},
		{"missing result", []byte(`{}`), "incomplete"},
		{"missing results", []byte(`{"result":{"height":"42"}}`), "incomplete"},
		{"missing deliveries", []byte(`{"result":{"height":"42","results":{}}}`), "incomplete"},
		{"malformed deliveries", []byte(`{"result":{"height":"42","results":{"deliver_tx":{}}}}`), "decode Launchpad delivered"},
		{"missing tx success", blockBody(t, "42", map[string]any{"ResponseBase": map[string]any{"Events": []any{blockEvent(TokenRealmPath, TokenCreatedType, valid)}}}), "no success status"},
		{"missing events field", blockBody(t, "42", map[string]any{"ResponseBase": map[string]any{"Error": nil}}), "no events field"},
		{"malformed events field", blockBody(t, "42", map[string]any{"ResponseBase": map[string]any{"Error": nil, "Events": map[string]any{}}}), "decode Launchpad tx"},
		{"duplicate raw attribute", blockBody(t, "42", blockTx(nil, blockEvent(TokenRealmPath, TokenCreatedType, bad))), "invalid LaunchpadTokenCreated"},
		{"missing target type", blockBody(t, "42", blockTx(nil, blockEvent(TokenRealmPath, "", valid))), "has no type"},
		{"null event entry", blockBody(t, "42", blockTx(nil, nil)), "has no type"},
		{"empty event entry", blockBody(t, "42", blockTx(nil, map[string]any{})), "has no type"},
		{"missing target package", blockBody(t, "42", blockTx(nil, blockEvent("", TokenCreatedType, valid))), "has no package path"},
		{"rpc error", []byte(`{"error":{"message":"unavailable"}}`), "RPC error"},
		{"bad JSON", []byte(`{`), "decode Launchpad"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, err := ParseBlockResults(tc.body, 42)
			if err == nil || !strings.Contains(err.Error(), tc.want) || len(got) != 0 {
				t.Fatalf("accepted bad block: %+v, %v", got, err)
			}
			if tc.name == "duplicate raw attribute" && !errors.Is(err, ErrInvalidTokenCreated) {
				t.Fatalf("lost validator error: %v", err)
			}
		})
	}
}
