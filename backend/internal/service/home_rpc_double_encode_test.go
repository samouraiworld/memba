package service

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
)

// TestCountTokens_EncodesDataExactlyOnceOnWire is a regression test for the
// home-snapshot double-base64 bug (B1).
//
// The home_rpc callers pre-base64-encoded the qrender data, and abciQueryOnce
// base64-encodes the data again on the wire, so gno.land received a doubly
// encoded path and every snapshot-sourced count silently read 0/empty in prod.
// The decode-once fakes used by the other home_rpc tests masked it because they
// modelled abciQueryOnce as NOT encoding.
//
// This test drives the REAL abciQuery (the default homeQuery) over an httptest
// server and asserts the wire `data` decodes EXACTLY ONCE back to the raw
// "<realmPath>:" qrender argument — the only honest description of the contract.
func TestCountTokens_EncodesDataExactlyOnceOnWire(t *testing.T) {
	var capturedData string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req abciQueryRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Errorf("decode request: %v", err)
		}
		capturedData = req.Params.Data
		render := "# Samcrew Token Factory (3 tokens)"
		respData := base64.StdEncoding.EncodeToString([]byte(render))
		_, _ = fmt.Fprintf(w, `{"jsonrpc":"2.0","id":1,"result":{"response":{"ResponseBase":{"Data":%q,"Error":null}}}}`, respData)
	}))
	defer srv.Close()

	s := newTestService(t) // homeQuery defaults to the real abciQuery

	n, err := s.countTokens(context.Background(), srv.URL)
	if err != nil {
		t.Fatalf("countTokens: %v", err)
	}
	if n != 3 {
		t.Fatalf("countTokens = %d, want 3", n)
	}

	// The wire `data` must decode EXACTLY ONCE to the raw qrender argument.
	// Under the double-encode bug it decodes to base64("<path>:"), not "<path>:".
	decoded, err := base64.StdEncoding.DecodeString(capturedData)
	if err != nil {
		t.Fatalf("wire data is not valid base64: %v", err)
	}
	want := tokenfactoryRealmPath() + ":"
	if string(decoded) != want {
		t.Fatalf("wire data decoded once = %q, want %q (double-base64 regression)", string(decoded), want)
	}
}
