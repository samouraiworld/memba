package launchpadindex

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"os"
	"testing"
	"time"
)

func blockFixture(t *testing.T) []byte {
	t.Helper()
	body, err := os.ReadFile("../indexer/testdata/block_260001.json")
	if err != nil {
		t.Fatal(err)
	}
	return body
}

func changedBlockFixture(t *testing.T, change func(map[string]any)) []byte {
	t.Helper()
	var body map[string]any
	if err := json.Unmarshal(blockFixture(t), &body); err != nil {
		t.Fatal(err)
	}
	change(body)
	encoded, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	return encoded
}

func blockResult(body map[string]any) map[string]any {
	return body["result"].(map[string]any)
}

func metaHeader(body map[string]any) map[string]any {
	return blockResult(body)["block_meta"].(map[string]any)["header"].(map[string]any)
}

func fullHeader(body map[string]any) map[string]any {
	return blockResult(body)["block"].(map[string]any)["header"].(map[string]any)
}

func TestParseBlockHeaderRealRPCFixture(t *testing.T) {
	got, err := ParseBlockHeader(blockFixture(t), "test-13", 260001)
	if err != nil {
		t.Fatal(err)
	}
	wantHash, err := base64.StdEncoding.DecodeString("e0Ys+MqemGQdf3UiOGXIx5VzWwZtplYzaAWDPqH62A8=")
	if err != nil {
		t.Fatal(err)
	}
	wantParent, err := base64.StdEncoding.DecodeString("d9gMXvDn05WbJWwuv+Q3Ag2Egbn9VQfed+ZYG13GPgk=")
	if err != nil {
		t.Fatal(err)
	}
	wantTime, err := time.Parse(time.RFC3339Nano, "2026-06-16T19:32:17.211442967Z")
	if err != nil {
		t.Fatal(err)
	}
	if got.ChainID != "test-13" || got.Height != 260001 ||
		string(got.Hash[:]) != string(wantHash) || string(got.ParentHash[:]) != string(wantParent) ||
		!got.Time.Equal(wantTime) || got.Time.Location() != time.UTC {
		t.Fatalf("wrong block observation: %+v", got)
	}
}

func TestParseBlockHeaderRejectsMismatchAndMissingEvidence(t *testing.T) {
	tests := []struct {
		name   string
		chain  string
		height int64
		change func(map[string]any)
	}{
		{"wrong expected chain", "gnoland-1", 260001, nil},
		{"wrong expected height", "test-13", 260002, nil},
		{"missing chain expectation", "", 260001, nil},
		{"missing height expectation", "test-13", 0, nil},
		{"metadata chain mismatch", "test-13", 260001, func(b map[string]any) { metaHeader(b)["chain_id"] = "gnoland-1" }},
		{"block chain mismatch", "test-13", 260001, func(b map[string]any) { fullHeader(b)["chain_id"] = "gnoland-1" }},
		{"metadata height mismatch", "test-13", 260001, func(b map[string]any) { metaHeader(b)["height"] = "260002" }},
		{"noncanonical height", "test-13", 260001, func(b map[string]any) { fullHeader(b)["height"] = "0260001" }},
		{"time disagreement", "test-13", 260001, func(b map[string]any) { fullHeader(b)["time"] = "2026-06-16T19:32:18Z" }},
		{"app hash disagreement", "test-13", 260001, func(b map[string]any) { fullHeader(b)["app_hash"] = "different" }},
		{"bad time", "test-13", 260001, func(b map[string]any) { metaHeader(b)["time"] = "not a time" }},
		{"missing hash", "test-13", 260001, func(b map[string]any) {
			blockResult(b)["block_meta"].(map[string]any)["block_id"].(map[string]any)["hash"] = ""
		}},
		{"short hash", "test-13", 260001, func(b map[string]any) {
			blockResult(b)["block_meta"].(map[string]any)["block_id"].(map[string]any)["hash"] = "AA=="
		}},
		{"missing parent hash", "test-13", 260001, func(b map[string]any) {
			delete(metaHeader(b), "last_block_id")
			delete(fullHeader(b), "last_block_id")
		}},
		{"short parent hash", "test-13", 260001, func(b map[string]any) {
			metaHeader(b)["last_block_id"].(map[string]any)["hash"] = "AA=="
			fullHeader(b)["last_block_id"].(map[string]any)["hash"] = "AA=="
		}},
		{"missing metadata", "test-13", 260001, func(b map[string]any) { delete(blockResult(b), "block_meta") }},
		{"missing full block", "test-13", 260001, func(b map[string]any) { delete(blockResult(b), "block") }},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			body := blockFixture(t)
			if tc.change != nil {
				body = changedBlockFixture(t, tc.change)
			}
			got, err := ParseBlockHeader(body, tc.chain, tc.height)
			if !errors.Is(err, ErrInvalidBlockHeader) || got != (BlockHeader{}) {
				t.Fatalf("accepted invalid header: %+v, %v", got, err)
			}
		})
	}
	if _, err := ParseBlockHeader([]byte(`{`), "test-13", 260001); err == nil {
		t.Fatal("malformed JSON accepted")
	}
	if _, err := ParseBlockHeader([]byte(`{"error":{"message":"node unavailable"}}`), "test-13", 260001); err == nil {
		t.Fatal("RPC error accepted")
	}
}
