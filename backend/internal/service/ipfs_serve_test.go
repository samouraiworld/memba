package service

import (
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// ──────────────────────────────────────────────────────────────────────────────
// Test helpers
// ──────────────────────────────────────────────────────────────────────────────

// newGatewayServer starts a local httptest server and returns it + a wired client.
func newGatewayServer(t *testing.T, handler http.Handler) (*httptest.Server, *http.Client) {
	t.Helper()
	ts := httptest.NewServer(handler)
	t.Cleanup(ts.Close)
	return ts, ts.Client()
}

// ──────────────────────────────────────────────────────────────────────────────
// resolveIPFSURI unit tests
// ──────────────────────────────────────────────────────────────────────────────

func TestResolveIPFSURI_ipfsScheme(t *testing.T) {
	gateway := "https://gateway.lighthouse.storage/ipfs/"
	cases := []struct {
		input   string
		want    string
		wantErr bool
	}{
		{
			input: "ipfs://QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG",
			want:  gateway + "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG",
		},
		{
			input: "ipfs://QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG/image.png",
			want:  gateway + "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG/image.png",
		},
		// bare CID (no scheme)
		{
			input: "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG",
			want:  gateway + "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG",
		},
	}
	for _, tc := range cases {
		got, err := resolveIPFSURI(tc.input, gateway)
		if tc.wantErr {
			if err == nil {
				t.Errorf("resolveIPFSURI(%q): expected error, got nil", tc.input)
			}
			continue
		}
		if err != nil {
			t.Errorf("resolveIPFSURI(%q): unexpected error: %v", tc.input, err)
			continue
		}
		if got != tc.want {
			t.Errorf("resolveIPFSURI(%q): got %q, want %q", tc.input, got, tc.want)
		}
	}
}

func TestResolveIPFSURI_SSRF(t *testing.T) {
	gateway := "https://gateway.lighthouse.storage/ipfs/"
	malicious := []string{
		"file:///etc/passwd",
		"ftp://somehost/file",
		"data:text/html,<h1>xss</h1>",
		"http://169.254.169.254/latest/meta-data/",
		"http://localhost/admin",
		"http://127.0.0.1/",
		"ipfs://../etc/passwd",
		"http://192.168.1.1/",
	}
	for _, input := range malicious {
		_, err := resolveIPFSURI(input, gateway)
		if err == nil {
			t.Errorf("resolveIPFSURI(%q): expected SSRF rejection, got nil error", input)
		}
	}
}

func TestResolveIPFSURI_EmptyAndInvalid(t *testing.T) {
	gateway := "https://gateway.lighthouse.storage/ipfs/"
	cases := []string{
		"",
		"ipfs://",
		"ipfs://!!invalidCID",
	}
	for _, input := range cases {
		_, err := resolveIPFSURI(input, gateway)
		if err == nil {
			t.Errorf("resolveIPFSURI(%q): expected error for empty/invalid input", input)
		}
	}
}

// ──────────────────────────────────────────────────────────────────────────────
// isPrivateIP tests
// ──────────────────────────────────────────────────────────────────────────────

func TestIsPrivateIP(t *testing.T) {
	cases := []struct {
		ip      string
		private bool
	}{
		{"127.0.0.1", true},
		{"10.0.0.1", true},
		{"172.16.0.1", true},
		{"192.168.1.1", true},
		{"169.254.169.254", true}, // AWS metadata
		{"100.64.0.1", true},      // CGN
		{"8.8.8.8", false},
		{"1.1.1.1", false},
		{"104.16.0.0", false}, // Cloudflare
	}
	for _, tc := range cases {
		ip := net.ParseIP(tc.ip)
		if ip == nil {
			t.Fatalf("net.ParseIP(%q) returned nil", tc.ip)
		}
		got := isPrivateIP(ip)
		if got != tc.private {
			t.Errorf("isPrivateIP(%q): got %v, want %v", tc.ip, got, tc.private)
		}
	}
}

// ──────────────────────────────────────────────────────────────────────────────
// HandleNFTImage handler tests
// ──────────────────────────────────────────────────────────────────────────────

func TestHandleNFTImage_MethodNotAllowed(t *testing.T) {
	handler := HandleNFTImage()
	req := httptest.NewRequest(http.MethodPost, "/api/nft/image?cid=QmFake", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("expected 405, got %d", rec.Code)
	}
}

func TestHandleNFTImage_MissingParam(t *testing.T) {
	handler := HandleNFTImage()
	req := httptest.NewRequest(http.MethodGet, "/api/nft/image", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", rec.Code)
	}
}

func TestHandleNFTImage_SSRFRejection(t *testing.T) {
	handler := HandleNFTImage()
	malicious := []string{
		"file:///etc/passwd",
		"http://127.0.0.1/",
	}
	for _, uri := range malicious {
		req := httptest.NewRequest(http.MethodGet, "/api/nft/image?uri="+uri, nil)
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusBadRequest {
			t.Errorf("expected 400 for SSRF URI %q, got %d", uri, rec.Code)
		}
	}
}

func TestHandleNFTImage_CacheMissAndHit(t *testing.T) {
	const fakeImage = "GIF89a\x01\x00\x01\x00\x00\xff\x00,\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x00;"
	const fakeCT = "image/gif"

	callCount := 0
	ts, client := newGatewayServer(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		callCount++
		w.Header().Set("Content-Type", fakeCT)
		_, _ = w.Write([]byte(fakeImage))
	}))

	// Use a fresh cache so this test is isolated from package-level cache state.
	origImageCache := nftImageCache
	nftImageCache = newLRUCache(nftCacheMaxEntries)
	t.Cleanup(func() { nftImageCache = origImageCache })

	gatewayBase := ts.URL + "/ipfs/"
	handler := HandleNFTImage(nftHandlerOptions{
		httpClient: client,
		gateway:    gatewayBase,
	})

	cid := "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG"

	// First request — MISS
	req := httptest.NewRequest(http.MethodGet, "/api/nft/image?cid="+cid, nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 on MISS, got %d: %s", rec.Code, rec.Body.String())
	}
	if rec.Header().Get("X-Cache") != "MISS" {
		t.Errorf("expected X-Cache: MISS, got %q", rec.Header().Get("X-Cache"))
	}
	if rec.Header().Get("Content-Type") != fakeCT {
		t.Errorf("expected Content-Type %q, got %q", fakeCT, rec.Header().Get("Content-Type"))
	}
	if rec.Header().Get("Cache-Control") != "public, max-age=86400, immutable" {
		t.Errorf("unexpected Cache-Control: %q", rec.Header().Get("Cache-Control"))
	}
	if rec.Body.String() != fakeImage {
		t.Errorf("body mismatch")
	}

	// Second request — HIT (no additional upstream call)
	req2 := httptest.NewRequest(http.MethodGet, "/api/nft/image?cid="+cid, nil)
	rec2 := httptest.NewRecorder()
	handler.ServeHTTP(rec2, req2)

	if rec2.Code != http.StatusOK {
		t.Fatalf("expected 200 on HIT, got %d", rec2.Code)
	}
	if rec2.Header().Get("X-Cache") != "HIT" {
		t.Errorf("expected X-Cache: HIT, got %q", rec2.Header().Get("X-Cache"))
	}
	if callCount != 1 {
		t.Errorf("expected exactly 1 upstream call (got %d) — cache not working", callCount)
	}
}

func TestHandleNFTImage_URIParam(t *testing.T) {
	const fakeImage = "\x89PNG\r\n\x1a\n"

	ts, client := newGatewayServer(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "image/png")
		_, _ = w.Write([]byte(fakeImage))
	}))

	origImageCache := nftImageCache
	nftImageCache = newLRUCache(nftCacheMaxEntries)
	t.Cleanup(func() { nftImageCache = origImageCache })

	gatewayBase := ts.URL + "/ipfs/"
	handler := HandleNFTImage(nftHandlerOptions{
		httpClient: client,
		gateway:    gatewayBase,
	})

	uri := "ipfs://QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG"
	req := httptest.NewRequest(http.MethodGet, "/api/nft/image?uri="+uri, nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestHandleNFTImage_UpstreamFailure(t *testing.T) {
	// Both primary and fallback return 404 to ensure the handler returns 502.
	ts, client := newGatewayServer(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))

	origImageCache := nftImageCache
	nftImageCache = newLRUCache(nftCacheMaxEntries)
	t.Cleanup(func() { nftImageCache = origImageCache })

	testGateway := ts.URL + "/ipfs/"
	handler := HandleNFTImage(nftHandlerOptions{
		httpClient:      client,
		gateway:         testGateway,
		fallbackGateway: testGateway, // same server → fallback also fails → 502
	})

	req := httptest.NewRequest(http.MethodGet, "/api/nft/image?cid=QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadGateway {
		t.Errorf("expected 502, got %d", rec.Code)
	}
}

// ──────────────────────────────────────────────────────────────────────────────
// HandleNFTMetadata handler tests
// ──────────────────────────────────────────────────────────────────────────────

func TestHandleNFTMetadata_MethodNotAllowed(t *testing.T) {
	handler := HandleNFTMetadata()
	req := httptest.NewRequest(http.MethodPost, "/api/nft/metadata?uri=ipfs://Qmfake", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("expected 405, got %d", rec.Code)
	}
}

func TestHandleNFTMetadata_MissingParam(t *testing.T) {
	handler := HandleNFTMetadata()
	req := httptest.NewRequest(http.MethodGet, "/api/nft/metadata", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", rec.Code)
	}
}

func TestHandleNFTMetadata_CacheMissAndHit(t *testing.T) {
	const metaJSON = `{"name":"Gno NFT #1","description":"A test NFT","image":"ipfs://QmImageCID","attributes":[]}`

	callCount := 0
	ts, client := newGatewayServer(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		callCount++
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(metaJSON))
	}))

	origMetaCache := nftMetadataCache
	nftMetadataCache = newLRUCache(nftCacheMaxEntries)
	t.Cleanup(func() { nftMetadataCache = origMetaCache })

	gatewayBase := ts.URL + "/ipfs/"
	handler := HandleNFTMetadata(nftHandlerOptions{
		httpClient: client,
		gateway:    gatewayBase,
	})

	uri := "ipfs://QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG"
	req := httptest.NewRequest(http.MethodGet, "/api/nft/metadata?uri="+uri, nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if rec.Header().Get("X-Cache") != "MISS" {
		t.Errorf("expected X-Cache: MISS, got %q", rec.Header().Get("X-Cache"))
	}

	// Verify image field was rewritten to proxy path.
	var result map[string]json.RawMessage
	if err := json.Unmarshal(rec.Body.Bytes(), &result); err != nil {
		t.Fatalf("response is not valid JSON: %v", err)
	}
	var imageVal string
	if err := json.Unmarshal(result["image"], &imageVal); err != nil {
		t.Fatalf("image field is not a string: %v", err)
	}
	if !strings.HasPrefix(imageVal, "/api/nft/image?uri=") {
		t.Errorf("image field not rewritten to proxy path: got %q", imageVal)
	}

	// Second request — HIT, no additional upstream call.
	req2 := httptest.NewRequest(http.MethodGet, "/api/nft/metadata?uri="+uri, nil)
	rec2 := httptest.NewRecorder()
	handler.ServeHTTP(rec2, req2)
	if rec2.Header().Get("X-Cache") != "HIT" {
		t.Errorf("expected X-Cache: HIT on second request, got %q", rec2.Header().Get("X-Cache"))
	}
	if callCount != 1 {
		t.Errorf("expected 1 upstream call, got %d", callCount)
	}
}

func TestHandleNFTMetadata_InvalidJSON(t *testing.T) {
	ts, client := newGatewayServer(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte("not-json"))
	}))

	origMetaCache := nftMetadataCache
	nftMetadataCache = newLRUCache(nftCacheMaxEntries)
	t.Cleanup(func() { nftMetadataCache = origMetaCache })

	handler := HandleNFTMetadata(nftHandlerOptions{
		httpClient: client,
		gateway:    ts.URL + "/ipfs/",
	})

	uri := "ipfs://QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG"
	req := httptest.NewRequest(http.MethodGet, "/api/nft/metadata?uri="+uri, nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadGateway {
		t.Errorf("expected 502, got %d", rec.Code)
	}
}

func TestHandleNFTMetadata_SSRFRejection(t *testing.T) {
	handler := HandleNFTMetadata()
	req := httptest.NewRequest(http.MethodGet, "/api/nft/metadata?uri=file:///etc/passwd", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for SSRF URI, got %d", rec.Code)
	}
}

func TestHandleNFTMetadata_ContentTypeHeader(t *testing.T) {
	const metaJSON = `{"name":"test"}`
	ts, client := newGatewayServer(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(metaJSON))
	}))

	origMetaCache := nftMetadataCache
	nftMetadataCache = newLRUCache(nftCacheMaxEntries)
	t.Cleanup(func() { nftMetadataCache = origMetaCache })

	handler := HandleNFTMetadata(nftHandlerOptions{
		httpClient: client,
		gateway:    ts.URL + "/ipfs/",
	})

	uri := "ipfs://QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG"
	req := httptest.NewRequest(http.MethodGet, "/api/nft/metadata?uri="+uri, nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	ct := rec.Header().Get("Content-Type")
	if !strings.HasPrefix(ct, "application/json") {
		t.Errorf("expected application/json content-type, got %q", ct)
	}
}

// ──────────────────────────────────────────────────────────────────────────────
// LRU cache unit tests
// ──────────────────────────────────────────────────────────────────────────────

func TestLRUCache_BasicGetSet(t *testing.T) {
	c := newLRUCache(2)
	e := cacheEntry{body: []byte("hello"), contentType: "text/plain", fetchedAt: time.Now()}
	c.set("k1", e)
	got, ok := c.get("k1")
	if !ok {
		t.Fatal("expected cache hit")
	}
	if string(got.body) != "hello" {
		t.Errorf("body mismatch: %q", got.body)
	}
}

func TestLRUCache_Eviction(t *testing.T) {
	c := newLRUCache(2)
	now := time.Now()
	c.set("k1", cacheEntry{body: []byte("1"), fetchedAt: now})
	c.set("k2", cacheEntry{body: []byte("2"), fetchedAt: now})
	c.set("k3", cacheEntry{body: []byte("3"), fetchedAt: now})
	// k1 should be evicted (LRU)
	_, ok := c.get("k1")
	if ok {
		t.Error("k1 should have been evicted")
	}
	_, ok2 := c.get("k2")
	_, ok3 := c.get("k3")
	if !ok2 || !ok3 {
		t.Error("k2 and k3 should still be cached")
	}
}

func TestLRUCache_MissOnUnknownKey(t *testing.T) {
	c := newLRUCache(10)
	_, ok := c.get("nonexistent")
	if ok {
		t.Error("expected cache miss for unknown key")
	}
}

// ──────────────────────────────────────────────────────────────────────────────
// validateCIDChars tests
// ──────────────────────────────────────────────────────────────────────────────

func TestValidateCIDChars(t *testing.T) {
	valid := []string{
		"QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG",
		"bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
	}
	for _, cid := range valid {
		if err := validateCIDChars(cid); err != nil {
			t.Errorf("validateCIDChars(%q): unexpected error: %v", cid, err)
		}
	}

	invalid := []string{
		"",
		"Qm",                // too short
		"Qm../etc/passwd",   // invalid chars (dots and slashes)
		"has spaces in it!", // spaces and special chars
	}
	for _, cid := range invalid {
		if err := validateCIDChars(cid); err == nil {
			t.Errorf("validateCIDChars(%q): expected error, got nil", cid)
		}
	}
}
