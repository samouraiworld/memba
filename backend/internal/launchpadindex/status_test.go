package launchpadindex

import (
	"encoding/json"
	"errors"
	"os"
	"testing"
)

func statusFixture(t *testing.T) []byte {
	t.Helper()
	body, err := os.ReadFile("../service/testdata/home/status.json")
	if err != nil {
		t.Fatal(err)
	}
	return body
}

func changedStatusFixture(t *testing.T, change func(map[string]any)) []byte {
	t.Helper()
	var body map[string]any
	if err := json.Unmarshal(statusFixture(t), &body); err != nil {
		t.Fatal(err)
	}
	change(body)
	encoded, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	return encoded
}

func statusResult(body map[string]any) map[string]any {
	return body["result"].(map[string]any)
}

func TestParseReadyStatusRealRPCFixture(t *testing.T) {
	got, err := ParseReadyStatus(statusFixture(t), "test-13")
	if err != nil || got.ChainID != "test-13" || got.LatestHeight != 321300 {
		t.Fatalf("wrong ready status: %+v, %v", got, err)
	}
}

func TestParseReadyStatusRejectsWrongOrIncompleteNode(t *testing.T) {
	tests := []struct {
		name, expected string
		change         func(map[string]any)
	}{
		{"missing expectation", "", nil},
		{"wrong chain expectation", "gnoland-1", nil},
		{"wrong network", "test-13", func(b map[string]any) { statusResult(b)["node_info"].(map[string]any)["network"] = "gnoland-1" }},
		{"missing result", "test-13", func(b map[string]any) { delete(b, "result") }},
		{"missing node", "test-13", func(b map[string]any) { delete(statusResult(b), "node_info") }},
		{"missing sync", "test-13", func(b map[string]any) { delete(statusResult(b), "sync_info") }},
		{"catching up", "test-13", func(b map[string]any) { statusResult(b)["sync_info"].(map[string]any)["catching_up"] = true }},
		{"missing catchup proof", "test-13", func(b map[string]any) { delete(statusResult(b)["sync_info"].(map[string]any), "catching_up") }},
		{"noncanonical height", "test-13", func(b map[string]any) {
			statusResult(b)["sync_info"].(map[string]any)["latest_block_height"] = "0321300"
		}},
		{"zero height", "test-13", func(b map[string]any) { statusResult(b)["sync_info"].(map[string]any)["latest_block_height"] = "0" }},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			body := statusFixture(t)
			if tc.change != nil {
				body = changedStatusFixture(t, tc.change)
			}
			got, err := ParseReadyStatus(body, tc.expected)
			if !errors.Is(err, ErrInvalidNodeStatus) || got != (ReadyStatus{}) {
				t.Fatalf("accepted invalid status: %+v, %v", got, err)
			}
		})
	}
	if _, err := ParseReadyStatus([]byte(`{`), "test-13"); err == nil {
		t.Fatal("malformed JSON accepted")
	}
	if _, err := ParseReadyStatus([]byte(`{"error":{"message":"node unavailable"}}`), "test-13"); err == nil {
		t.Fatal("RPC error accepted")
	}
}
