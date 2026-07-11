package service

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
)

// Live upload check against the REAL Lighthouse endpoint (node.lighthouse.storage).
// Gated behind LIGHTHOUSE_API_KEY so CI stays hermetic — mirrors the MEMBA_LIVE_RPC
// gate in render_proxy_live_test.go. Run with:
//
//	LIGHTHOUSE_API_KEY=<key> go test ./internal/service/ -run Live_IPFSUpload -v
//
// It exercises the production entrypoint with NO injection seam, so the handler POSTs
// to the hard-coded lighthouseUploadURL with the server-side bearer and we assert a
// real CID comes back — the end-to-end path the hermetic tests can only mock.
func TestLive_IPFSUploadImage_ReturnsRealCID(t *testing.T) {
	if os.Getenv("LIGHTHOUSE_API_KEY") == "" {
		t.Skip("set LIGHTHOUSE_API_KEY to run the live Lighthouse upload check")
	}

	// A real 1x1 transparent PNG — passes both the declared-type and magic-byte checks.
	png, err := base64.StdEncoding.DecodeString(
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==")
	if err != nil {
		t.Fatalf("decode test PNG: %v", err)
	}

	body, ct := buildUploadBody(t, "image/png", png)
	req := httptest.NewRequest(http.MethodPost, "/api/upload/image", body)
	req.Header.Set("Content-Type", ct)
	rec := httptest.NewRecorder()

	HandleIPFSUploadImage().ServeHTTP(rec, req) // no seam → real node.lighthouse.storage

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 from live upload, got %d (body=%q)", rec.Code, rec.Body.String())
	}
	var resp struct {
		CID string `json:"cid"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode response: %v (body=%q)", err, rec.Body.String())
	}
	if resp.CID == "" {
		t.Fatalf("expected a non-empty CID from Lighthouse, got body=%q", rec.Body.String())
	}
	t.Logf("live Lighthouse upload returned CID %s", resp.CID)
}
