package service

import (
	"context"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"reflect"
	"strings"
	"testing"
	"time"
)

// ──────────────────────────────────────────────────────────────────────────────
// Test helpers
// ──────────────────────────────────────────────────────────────────────────────

// newGatewayServer starts a local TLS server but exposes a documentation-only
// public IP in its URL. The wired client dials the local listener directly, so
// gateway-policy tests stay deterministic without weakening production guards.
func newGatewayServer(t *testing.T, handler http.Handler) (*httptest.Server, *http.Client) {
	t.Helper()
	ts := httptest.NewTLSServer(handler)
	t.Cleanup(ts.Close)

	client := ts.Client()
	transport := client.Transport.(*http.Transport)
	testAddr := ts.Listener.Addr().String()
	transport.Proxy = nil
	// The URL deliberately names a public test address while DialContext pins the
	// connection to this process-local listener, so its generated certificate
	// cannot match the request host. This client never leaves the test listener.
	transport.TLSClientConfig.InsecureSkipVerify = true // #nosec G402 -- local test server only
	transport.DialContext = func(ctx context.Context, network, _ string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, network, testAddr)
	}
	ts.URL = "https://93.184.216.34"
	return ts, client
}

// ──────────────────────────────────────────────────────────────────────────────
// resolveIPFSURI unit tests
// ──────────────────────────────────────────────────────────────────────────────

// SEC-4: the pinned dialer refuses to connect to a private/reserved IP even when
// a (rebinding) DNS record resolves to one — the IP guard is authoritative at
// connect time, not only at validation time.
func TestSafeDialContext_RejectsPrivateAndMetadata(t *testing.T) {
	for _, addr := range []string{
		"127.0.0.1:80",            // loopback
		"169.254.169.254:80",      // AWS/GCP metadata
		"10.0.0.5:80",             // RFC1918
		"192.168.1.1:80",          // RFC1918
		"[::]:80",                 // IPv6 unspecified / this host
		"[::ffff:127.0.0.1]:80",   // IPv4-mapped loopback
		"[fec0::1]:80",            // deprecated site-local
		"[64:ff9b::a9fe:a9fe]:80", // NAT64-encoded metadata IP
		"[2002:7f00:0001::]:80",   // 6to4-encoded loopback
	} {
		if _, err := safeDialContext(context.Background(), "tcp", addr); err == nil {
			t.Errorf("safeDialContext(%q) = nil error, want refusal (private/reserved IP)", addr)
		}
	}
}

func TestSafeTransport_DoesNotInheritProcessDefaultHooks(t *testing.T) {
	defaultTransport, ok := http.DefaultTransport.(*http.Transport)
	if !ok {
		t.Fatalf("http.DefaultTransport has type %T, want *http.Transport", http.DefaultTransport)
	}

	originalProxy := defaultTransport.Proxy
	originalDialTLSContext := defaultTransport.DialTLSContext
	legacyDialTLS := reflect.ValueOf(defaultTransport).Elem().FieldByName("DialTLS")
	originalLegacyDialTLS := reflect.New(legacyDialTLS.Type()).Elem()
	originalLegacyDialTLS.Set(legacyDialTLS)
	t.Cleanup(func() {
		defaultTransport.Proxy = originalProxy
		defaultTransport.DialTLSContext = originalDialTLSContext
		legacyDialTLS.Set(originalLegacyDialTLS)
	})

	defaultTransport.Proxy = func(*http.Request) (*url.URL, error) {
		return url.Parse("http://127.0.0.1:3128")
	}
	defaultTransport.DialTLSContext = func(context.Context, string, string) (net.Conn, error) {
		return nil, context.Canceled
	}
	legacyDialTLS.Set(reflect.ValueOf(func(string, string) (net.Conn, error) {
		return nil, context.Canceled
	}))

	transport := safeTransport()
	if transport == defaultTransport {
		t.Fatal("safeTransport must construct a fresh transport")
	}
	if transport.Proxy != nil {
		t.Fatal("safeTransport.Proxy inherited the process-global proxy hook")
	}
	if transport.DialTLSContext != nil {
		t.Fatal("safeTransport.DialTLSContext inherited the process-global TLS dial hook")
	}
	if got := reflect.ValueOf(transport).Elem().FieldByName("DialTLS"); !got.IsNil() {
		t.Fatal("safeTransport legacy DialTLS inherited the process-global TLS dial hook")
	}
	if transport.DialContext == nil {
		t.Fatal("safeTransport must route every connection through the guarded DialContext")
	}
}

func TestResolveIPFSURI_ipfsScheme(t *testing.T) {
	gateway := "https://93.184.216.34/ipfs/"
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

func TestResolveIPFSURI_PublicHTTPS(t *testing.T) {
	const publicURL = "https://93.184.216.34/nft/metadata.json"
	got, err := resolveIPFSURI(publicURL, "https://93.184.216.34/ipfs/")
	if err != nil {
		t.Fatalf("resolveIPFSURI(public HTTPS): %v", err)
	}
	if got != publicURL {
		t.Fatalf("resolveIPFSURI(public HTTPS) = %q, want %q", got, publicURL)
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

// validateRedirect must re-apply the SSRF/scheme checks on every redirect hop —
// the initial-URL validation in resolveIPFSURI does not cover where a redirect
// points (the metadata-IP / internal-host bypass).
func TestValidateRedirect_RejectsUnsafeHops(t *testing.T) {
	cases := []struct {
		name string
		url  string
	}{
		{"http downgrade (public IP)", "http://93.184.216.34/x"},
		{"link-local metadata IP via https", "https://169.254.169.254/latest/meta-data/"},
		{"private 10/8 via https", "https://10.0.0.5/x"},
		{"loopback via https", "https://127.0.0.1/x"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			u, err := url.Parse(tc.url)
			if err != nil {
				t.Fatalf("bad test url: %v", err)
			}
			if err := validateRedirect(&http.Request{URL: u}, nil); err == nil {
				t.Errorf("validateRedirect(%q): expected rejection, got nil", tc.url)
			}
		})
	}
}

func TestValidateRedirect_RejectsTooManyHops(t *testing.T) {
	u, _ := url.Parse("https://93.184.216.34/x") // public — would otherwise pass
	via := make([]*http.Request, maxNFTRedirects)
	if err := validateRedirect(&http.Request{URL: u}, via); err == nil {
		t.Error("expected too-many-redirects rejection, got nil")
	}
}

func TestValidateRedirect_AllowsPublicHTTPS(t *testing.T) {
	u, _ := url.Parse("https://93.184.216.34/ok") // public IP literal — no DNS
	if err := validateRedirect(&http.Request{URL: u}, nil); err != nil {
		t.Errorf("validateRedirect(public https): unexpected error: %v", err)
	}
}

// End-to-end: a request that reaches a public-name TLS origin must still refuse
// that origin's redirect to a private TLS host instead of fetching it (the SSRF
// the proxy enables because it is unauthenticated).
func TestHTTPClient_RefusesPublicTLSRedirectToPrivateHost(t *testing.T) {
	secretHits := 0
	secret := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		secretHits++
		_, _ = w.Write([]byte("internal-secret"))
	}))
	defer secret.Close()

	redirectHits := 0
	redirector, client := newGatewayServer(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		redirectHits++
		http.Redirect(w, r, secret.URL, http.StatusFound) // → https://127.0.0.1:…
	}))
	client.CheckRedirect = validateRedirect

	body, _, err := doFetch(client, redirector.URL)
	if err == nil {
		t.Fatalf("expected redirect to a private host to be refused; got body %q", string(body))
	}
	if redirectHits != 1 {
		t.Fatalf("public-name TLS redirector hits = %d, want 1", redirectHits)
	}
	if secretHits != 0 {
		t.Fatalf("private TLS target hits = %d, want 0", secretHits)
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
// Public-destination policy tests
// ──────────────────────────────────────────────────────────────────────────────

func TestIsPublicDestinationIP(t *testing.T) {
	cases := []struct {
		ip     string
		public bool
	}{
		{"0.0.0.0", false},
		{"127.0.0.1", false},
		{"10.0.0.1", false},
		{"172.16.0.1", false},
		{"192.168.1.1", false},
		{"169.254.169.254", false}, // cloud metadata / link-local
		{"100.64.0.1", false},      // CGNAT
		{"192.0.2.1", false},       // documentation
		{"192.88.99.1", false},     // deprecated relay anycast
		{"198.18.0.1", false},      // benchmarking
		{"224.0.0.1", false},       // multicast
		{"240.0.0.1", false},       // reserved
		{"::", false},
		{"::1", false},
		{"fc00::1", false},
		{"fec0::1", false},
		{"fe80::1", false},
		{"ff02::1", false},
		{"100:0:0:1::1", false},
		{"2001:5::1", false},
		{"2001:db8::1", false},
		{"3fff::1", false},
		{"4000::1", false},
		{"::ffff:127.0.0.1", false},     // IPv4-mapped loopback
		{"64:ff9b::a9fe:a9fe", false},   // NAT64-encoded metadata IP
		{"64:ff9b:1::a9fe:a9fe", false}, // local-use translation prefix
		{"2002:7f00:0001::", false},     // 6to4-encoded loopback
		{"8.8.8.8", true},
		{"1.1.1.1", true},
		{"104.16.0.0", true},
		{"::ffff:8.8.8.8", true},       // mapped public IPv4
		{"64:ff9b::808:808", true},     // NAT64-encoded public IPv4
		{"2002:0808:0808::", false},    // 6to4 has no guaranteed global reachability
		{"2001:1::1", true},            // PCP anycast exception in 2001::/23
		{"2001:1::2", true},            // TURN anycast exception in 2001::/23
		{"2001:1::3", true},            // DNS-SD anycast exception in 2001::/23
		{"2001:3::1", true},            // AMT
		{"2001:4:112::1", true},        // AS112-v6
		{"2001:20::1", true},           // ORCHIDv2
		{"2001:30::1", true},           // Drone Remote ID entity tags
		{"2606:4700:4700::1111", true}, // public IPv6
		{"2001:4860:4860::8888", true}, // public IPv6
	}
	for _, tc := range cases {
		ip := net.ParseIP(tc.ip)
		if ip == nil {
			t.Fatalf("net.ParseIP(%q) returned nil", tc.ip)
		}
		got := isPublicDestinationIP(ip)
		if got != tc.public {
			t.Errorf("isPublicDestinationIP(%q): got %v, want %v", tc.ip, got, tc.public)
		}
	}
	if isPublicDestinationIP(nil) {
		t.Error("isPublicDestinationIP(nil) = true, want false")
	}
}

func TestValidateIPFSGateway(t *testing.T) {
	cases := []struct {
		name    string
		raw     string
		want    string
		wantErr bool
	}{
		{"public https normalized", "https://93.184.216.34/ipfs", "https://93.184.216.34/ipfs/", false},
		{"public NAT64 normalized", "https://[64:ff9b::808:808]/ipfs/", "https://[64:ff9b::808:808]/ipfs/", false},
		{"plain http", "http://93.184.216.34/ipfs/", "", true},
		{"empty host", "https:///ipfs/", "", true},
		{"credentials", "https://user:pass@93.184.216.34/ipfs/", "", true},
		{"query", "https://93.184.216.34/ipfs/?token=x", "", true},
		{"fragment", "https://93.184.216.34/ipfs/#x", "", true},
		{"private", "https://127.0.0.1/ipfs/", "", true},
		{"unspecified ipv6", "https://[::]/ipfs/", "", true},
		{"nat64 metadata", "https://[64:ff9b::a9fe:a9fe]/ipfs/", "", true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := validateIPFSGateway(tc.raw)
			if tc.wantErr {
				if err == nil {
					t.Fatalf("validateIPFSGateway(%q) = %q, want error", tc.raw, got)
				}
				return
			}
			if err != nil {
				t.Fatalf("validateIPFSGateway(%q): %v", tc.raw, err)
			}
			if got != tc.want {
				t.Errorf("validateIPFSGateway(%q) = %q, want %q", tc.raw, got, tc.want)
			}
		})
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

func TestHandleNFTImage_InvalidGatewayConfiguration(t *testing.T) {
	origImageCache := nftImageCache
	nftImageCache = newLRUCache(nftCacheMaxEntries)
	t.Cleanup(func() { nftImageCache = origImageCache })
	t.Setenv("IPFS_GATEWAY_URL", "http://127.0.0.1/ipfs/")

	handler := HandleNFTImage()
	req := httptest.NewRequest(http.MethodGet, "/api/nft/image?cid=QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500 for invalid gateway configuration, got %d", rec.Code)
	}
}

func TestHandleNFTImage_CacheHitDoesNotResolveGateway(t *testing.T) {
	const cid = "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG"
	origImageCache := nftImageCache
	nftImageCache = newLRUCache(nftCacheMaxEntries)
	nftImageCache.set(cid, cacheEntry{body: []byte("cached"), contentType: "image/png", fetchedAt: time.Now()})
	t.Cleanup(func() { nftImageCache = origImageCache })

	handler := HandleNFTImage(nftHandlerOptions{gateway: "https://does-not-resolve.invalid/ipfs/"})
	req := httptest.NewRequest(http.MethodGet, "/api/nft/image?cid="+cid, nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || rec.Header().Get("X-Cache") != "HIT" {
		t.Fatalf("cached response = status %d, X-Cache %q; want 200 HIT", rec.Code, rec.Header().Get("X-Cache"))
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

func TestHandleNFTImage_InvalidFallbackGatewayIsNotFetched(t *testing.T) {
	var callCount int
	ts, client := newGatewayServer(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		callCount++
		w.WriteHeader(http.StatusNotFound)
	}))

	origImageCache := nftImageCache
	nftImageCache = newLRUCache(nftCacheMaxEntries)
	t.Cleanup(func() { nftImageCache = origImageCache })

	handler := HandleNFTImage(nftHandlerOptions{
		httpClient:      client,
		gateway:         ts.URL + "/ipfs/",
		fallbackGateway: "http://127.0.0.1/ipfs/",
	})
	req := httptest.NewRequest(http.MethodGet, "/api/nft/image?cid=QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadGateway {
		t.Fatalf("expected 502, got %d", rec.Code)
	}
	if callCount != 1 {
		t.Fatalf("invalid fallback must not be fetched; primary calls = %d, want 1", callCount)
	}
}

// S-F1: the image proxy mirrors the upstream Content-Type. Without anti-sniffing
// protection an IPFS-pinned HTML file could be served as an active page on the API
// origin. Every served image response must carry X-Content-Type-Options: nosniff,
// constrain the Content-Type to image/* (coercing anything else to
// application/octet-stream rather than echoing it), and set
// Content-Disposition: inline.
func TestHandleNFTImage_AntiSniffing(t *testing.T) {
	cases := []struct {
		name       string
		upstreamCT string // "" → send no Content-Type header (upstream gives none)
		body       string
		wantCT     string
	}{
		{"html coerced to octet-stream", "text/html; charset=utf-8", "<html><body>x</body></html>", "application/octet-stream"},
		{"svg+xml coerced to octet-stream", "image/svg+xml", "<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>", "application/octet-stream"},
		{"text/plain coerced to octet-stream", "text/plain", "plain text", "application/octet-stream"},
		{"missing upstream type coerced to octet-stream", "", "plain text, sniffs to text/plain", "application/octet-stream"},
		{"png preserved", "image/png", "\x89PNG\r\n\x1a\n", "image/png"},
		{"gif preserved", "image/gif", "GIF89a", "image/gif"},
		{"jpeg with params preserved", "image/jpeg; charset=binary", "\xff\xd8\xff", "image/jpeg; charset=binary"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ts, client := newGatewayServer(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				if tc.upstreamCT != "" {
					w.Header().Set("Content-Type", tc.upstreamCT)
				}
				_, _ = w.Write([]byte(tc.body))
			}))

			// Fresh cache so each sub-case is isolated.
			origImageCache := nftImageCache
			nftImageCache = newLRUCache(nftCacheMaxEntries)
			t.Cleanup(func() { nftImageCache = origImageCache })

			handler := HandleNFTImage(nftHandlerOptions{
				httpClient: client,
				gateway:    ts.URL + "/ipfs/",
			})

			cid := "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG"
			req := httptest.NewRequest(http.MethodGet, "/api/nft/image?cid="+cid, nil)
			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, req)

			if rec.Code != http.StatusOK {
				t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
			}
			if got := rec.Header().Get("X-Content-Type-Options"); got != "nosniff" {
				t.Errorf("X-Content-Type-Options: got %q, want %q", got, "nosniff")
			}
			if got := rec.Header().Get("Content-Type"); got != tc.wantCT {
				t.Errorf("Content-Type: got %q, want %q (upstream %q)", got, tc.wantCT, tc.upstreamCT)
			}
			if got := rec.Header().Get("Content-Disposition"); got != "inline" {
				t.Errorf("Content-Disposition: got %q, want %q", got, "inline")
			}
		})
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

func TestHandleNFTMetadata_InvalidGatewayConfiguration(t *testing.T) {
	origMetaCache := nftMetadataCache
	nftMetadataCache = newLRUCache(nftCacheMaxEntries)
	t.Cleanup(func() { nftMetadataCache = origMetaCache })
	t.Setenv("IPFS_GATEWAY_URL", "https://[::]/ipfs/")

	handler := HandleNFTMetadata()
	req := httptest.NewRequest(http.MethodGet, "/api/nft/metadata?uri=ipfs://QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500 for invalid gateway configuration, got %d", rec.Code)
	}
}

func TestHandleNFTMetadata_CacheHitDoesNotResolveGateway(t *testing.T) {
	const uri = "ipfs://QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG"
	origMetaCache := nftMetadataCache
	nftMetadataCache = newLRUCache(nftCacheMaxEntries)
	nftMetadataCache.set(uri, cacheEntry{body: []byte(`{"name":"cached"}`), contentType: "application/json", fetchedAt: time.Now()})
	t.Cleanup(func() { nftMetadataCache = origMetaCache })

	handler := HandleNFTMetadata(nftHandlerOptions{gateway: "https://does-not-resolve.invalid/ipfs/"})
	req := httptest.NewRequest(http.MethodGet, "/api/nft/metadata?uri="+uri, nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || rec.Header().Get("X-Cache") != "HIT" {
		t.Fatalf("cached response = status %d, X-Cache %q; want 200 HIT", rec.Code, rec.Header().Get("X-Cache"))
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

func TestLRUCache_EvictsByBytes(t *testing.T) {
	// Count limit generous so the byte budget is what binds.
	c := newLRUCacheBounded(1000, 300)
	now := time.Now()
	put := func(k string, n int) {
		c.set(k, cacheEntry{body: make([]byte, n), fetchedAt: now})
	}
	put("a", 100)
	put("b", 100)
	put("c", 100) // 300 bytes total — exactly at budget
	put("d", 100) // 400 would exceed → LRU "a" evicted back to 300

	if _, ok := c.get("a"); ok {
		t.Error("expected 'a' evicted by the byte budget")
	}
	for _, k := range []string{"b", "c", "d"} {
		if _, ok := c.get(k); !ok {
			t.Errorf("expected %q to still be cached", k)
		}
	}
	if c.curBytes > 300 {
		t.Errorf("curBytes = %d, must not exceed maxBytes 300", c.curBytes)
	}
}

func TestLRUCache_SkipsOversizedEntry(t *testing.T) {
	// An entry bigger than the whole budget must not be cached — otherwise it
	// force-evicts everything and is still over budget.
	c := newLRUCacheBounded(1000, 100)
	c.set("big", cacheEntry{body: make([]byte, 200), fetchedAt: time.Now()})
	if _, ok := c.get("big"); ok {
		t.Error("an entry larger than the whole byte budget must not be cached")
	}
	if c.curBytes != 0 {
		t.Errorf("curBytes = %d, want 0", c.curBytes)
	}
}

func TestNFTCachesAreByteBounded(t *testing.T) {
	// The prod image/metadata caches MUST carry a positive byte budget, or a
	// flood of distinct large CIDs OOMs the 512MB VM (256 entries × 15MB × 2 ≈ 7.7GB).
	for name, c := range map[string]*lruCache{"image": nftImageCache, "metadata": nftMetadataCache} {
		if c.maxBytes != nftCacheMaxBytes || c.maxBytes <= 0 {
			t.Errorf("%s cache maxBytes=%d, want positive %d", name, c.maxBytes, nftCacheMaxBytes)
		}
	}
}

func TestLRUCache_ReplaceAdjustsBytes(t *testing.T) {
	// The trickiest accounting path: replacing a key must apply the size DELTA.
	c := newLRUCacheBounded(1000, 1000)
	c.set("k", cacheEntry{body: make([]byte, 100), fetchedAt: time.Now()})
	if c.curBytes != 100 {
		t.Fatalf("curBytes = %d after insert, want 100", c.curBytes)
	}
	c.set("k", cacheEntry{body: make([]byte, 40), fetchedAt: time.Now()}) // shrink
	if c.curBytes != 40 {
		t.Errorf("curBytes = %d after shrinking replace, want 40", c.curBytes)
	}
	c.set("k", cacheEntry{body: make([]byte, 250), fetchedAt: time.Now()}) // grow
	if c.curBytes != 250 {
		t.Errorf("curBytes = %d after growing replace, want 250", c.curBytes)
	}
}

func TestLRUCache_OversizedReplaceEvictsExisting(t *testing.T) {
	// Replacing a resident key with a body bigger than the whole budget must
	// drop the entry AND zero out its bytes (the oversized-skip branch).
	c := newLRUCacheBounded(1000, 100)
	c.set("k", cacheEntry{body: make([]byte, 50), fetchedAt: time.Now()})
	c.set("k", cacheEntry{body: make([]byte, 200), fetchedAt: time.Now()})
	if _, ok := c.get("k"); ok {
		t.Error("oversized replacement should have evicted the existing entry")
	}
	if c.curBytes != 0 {
		t.Errorf("curBytes = %d, want 0", c.curBytes)
	}
}

func TestLRUCache_TTLExpiryAdjustsBytes(t *testing.T) {
	// A TTL-expired entry removed on read must also release its bytes.
	c := newLRUCacheBounded(1000, 1000)
	c.set("k", cacheEntry{body: make([]byte, 100), fetchedAt: time.Now().Add(-nftCacheTTL - time.Minute)})
	if _, ok := c.get("k"); ok {
		t.Error("expected TTL-expired entry to miss")
	}
	if c.curBytes != 0 {
		t.Errorf("curBytes = %d after TTL expiry, want 0", c.curBytes)
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
