package service

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"
)

// ──────────────────────────────────────────────────────────────────────────────
// Constants & configuration
// ──────────────────────────────────────────────────────────────────────────────

const (
	// maxNFTResponseSize caps the upstream response we will buffer and serve (15 MB).
	maxNFTResponseSize = 15 * 1024 * 1024

	// nftFetchTimeout is the per-upstream-fetch deadline.
	nftFetchTimeout = 10 * time.Second

	// maxNFTRedirects caps redirect-following in the NFT proxy. Each hop is
	// re-validated by validateRedirect; the cap also bounds redirect-loop abuse.
	maxNFTRedirects = 5

	// nftCacheMaxEntries is the maximum number of cache entries (image + metadata combined).
	nftCacheMaxEntries = 256

	// nftCacheMaxBytes caps the total body bytes held by EACH media cache (image
	// and metadata). Bounding by entry count alone let 256 entries × 15MB × 2
	// caches (~7.7GB) OOM the 512MB VM under a flood of distinct large CIDs; the
	// byte budget makes eviction size-aware. 64MB each → 128MB combined, safe on 512MB.
	nftCacheMaxBytes = 64 * 1024 * 1024

	// nftCacheTTL is how long an entry stays warm in the in-memory cache.
	nftCacheTTL = 24 * time.Hour

	// fallbackGateway is the secondary gateway tried when the primary fails.
	fallbackGateway = "https://dweb.link/ipfs/"
)

// ipfsGatewayURL returns the configured primary IPFS gateway base URL.
// Defaults to the Lighthouse gateway already used by the upload proxy.
func ipfsGatewayURL() string {
	if g := os.Getenv("IPFS_GATEWAY_URL"); g != "" {
		return strings.TrimRight(g, "/") + "/"
	}
	return "https://gateway.lighthouse.storage/ipfs/"
}

// ──────────────────────────────────────────────────────────────────────────────
// Simple in-memory LRU cache (no external dependency, bounded by entry count)
// ──────────────────────────────────────────────────────────────────────────────

type cacheEntry struct {
	body        []byte
	contentType string
	etag        string
	fetchedAt   time.Time
}

// lruCache is a minimal, thread-safe LRU cache backed by a map + doubly linked list.
type lruCache struct {
	mu       sync.Mutex
	maxSize  int
	maxBytes int // total-body-bytes ceiling; 0 disables byte-based eviction
	curBytes int // running sum of cached body bytes
	items    map[string]*lruNode
	head     *lruNode // most recently used
	tail     *lruNode // least recently used
}

type lruNode struct {
	key   string
	value cacheEntry
	prev  *lruNode
	next  *lruNode
}

// newLRUCache builds a cache bounded only by entry count (no byte ceiling).
func newLRUCache(maxSize int) *lruCache {
	return newLRUCacheBounded(maxSize, 0)
}

// newLRUCacheBounded builds a cache bounded by BOTH entry count and total body
// bytes. A maxBytes of 0 disables the byte ceiling (count-only).
func newLRUCacheBounded(maxSize, maxBytes int) *lruCache {
	return &lruCache{
		maxSize:  maxSize,
		maxBytes: maxBytes,
		items:    make(map[string]*lruNode),
	}
}

func (c *lruCache) get(key string) (cacheEntry, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	node, ok := c.items[key]
	if !ok {
		return cacheEntry{}, false
	}
	if time.Since(node.value.fetchedAt) > nftCacheTTL {
		c.curBytes -= len(node.value.body)
		c.removeNode(node)
		delete(c.items, key)
		return cacheEntry{}, false
	}
	c.moveToFront(node)
	return node.value, true
}

func (c *lruCache) set(key string, entry cacheEntry) {
	c.mu.Lock()
	defer c.mu.Unlock()
	newLen := len(entry.body)
	// An entry larger than the whole byte budget is never cached: it would
	// force-evict everything else and still be over. Drop any stale copy + skip.
	if c.maxBytes > 0 && newLen > c.maxBytes {
		if node, ok := c.items[key]; ok {
			c.curBytes -= len(node.value.body)
			delete(c.items, key)
			c.removeNode(node)
		}
		return
	}
	if node, ok := c.items[key]; ok {
		c.curBytes += newLen - len(node.value.body)
		node.value = entry
		c.moveToFront(node)
	} else {
		node := &lruNode{key: key, value: entry}
		c.items[key] = node
		c.curBytes += newLen
		c.pushFront(node)
	}
	c.evict()
}

// evict removes least-recently-used entries until BOTH the entry-count and (when
// set) the byte budget hold. The just-inserted entry sits at the head and is
// ≤ maxBytes, so it is never the one evicted.
func (c *lruCache) evict() {
	for c.tail != nil && (len(c.items) > c.maxSize || (c.maxBytes > 0 && c.curBytes > c.maxBytes)) {
		lru := c.tail
		c.curBytes -= len(lru.value.body)
		delete(c.items, lru.key)
		c.removeNode(lru)
	}
}

func (c *lruCache) pushFront(node *lruNode) {
	node.prev = nil
	node.next = c.head
	if c.head != nil {
		c.head.prev = node
	}
	c.head = node
	if c.tail == nil {
		c.tail = node
	}
}

func (c *lruCache) removeNode(node *lruNode) {
	if node.prev != nil {
		node.prev.next = node.next
	} else {
		c.head = node.next
	}
	if node.next != nil {
		node.next.prev = node.prev
	} else {
		c.tail = node.prev
	}
	node.prev = nil
	node.next = nil
}

func (c *lruCache) moveToFront(node *lruNode) {
	if c.head == node {
		return
	}
	c.removeNode(node)
	c.pushFront(node)
}

// ──────────────────────────────────────────────────────────────────────────────
// Shared caches (package-level singletons, initialised once)
// ──────────────────────────────────────────────────────────────────────────────

var (
	nftImageCache    = newLRUCacheBounded(nftCacheMaxEntries, nftCacheMaxBytes)
	nftMetadataCache = newLRUCacheBounded(nftCacheMaxEntries, nftCacheMaxBytes)
)

// ──────────────────────────────────────────────────────────────────────────────
// SSRF / URI validation
// ──────────────────────────────────────────────────────────────────────────────

// privateIPBlocks are CIDR ranges that are never fetched from.
var privateIPBlocks []*net.IPNet

func init() {
	cidrs := []string{
		"127.0.0.0/8",    // loopback
		"10.0.0.0/8",     // RFC1918
		"172.16.0.0/12",  // RFC1918
		"192.168.0.0/16", // RFC1918
		"169.254.0.0/16", // link-local / AWS metadata
		"::1/128",        // IPv6 loopback
		"fc00::/7",       // IPv6 unique local
		"fe80::/10",      // IPv6 link-local
		"100.64.0.0/10",  // CGN
		"0.0.0.0/8",      // this host
	}
	for _, cidr := range cidrs {
		_, block, _ := net.ParseCIDR(cidr)
		privateIPBlocks = append(privateIPBlocks, block)
	}
}

func isPrivateIP(ip net.IP) bool {
	for _, block := range privateIPBlocks {
		if block.Contains(ip) {
			return true
		}
	}
	return false
}

// resolveIPFSURI turns an ipfs:// or https:// (or a bare CID) into a fetch URL.
// Returns an error for any disallowed scheme, private host, or malformed input.
//
//   - ipfs://CID/path  → <gateway>CID/path
//   - https://…        → pass-through (host private-IP checked)
//   - bare CID         → <gateway>CID
func resolveIPFSURI(rawURI, gateway string) (string, error) {
	rawURI = strings.TrimSpace(rawURI)
	if rawURI == "" {
		return "", fmt.Errorf("empty URI")
	}

	switch {
	case strings.HasPrefix(rawURI, "ipfs://"):
		// ipfs://CID or ipfs://CID/sub/path
		rest := strings.TrimPrefix(rawURI, "ipfs://")
		// Guard against path traversal tricks like ipfs://../etc/passwd
		if strings.Contains(rest, "..") {
			return "", fmt.Errorf("path traversal not allowed")
		}
		cid, subpath, _ := strings.Cut(rest, "/")
		if err := validateCIDChars(cid); err != nil {
			return "", err
		}
		if subpath != "" {
			return gateway + cid + "/" + subpath, nil
		}
		return gateway + cid, nil

	case strings.HasPrefix(rawURI, "https://"):
		if err := validateHTTPSHost(rawURI); err != nil {
			return "", err
		}
		return rawURI, nil

	case strings.HasPrefix(rawURI, "http://"):
		return "", fmt.Errorf("plain http not allowed; use https")

	case strings.HasPrefix(rawURI, "file://"),
		strings.HasPrefix(rawURI, "ftp://"),
		strings.HasPrefix(rawURI, "data:"):
		return "", fmt.Errorf("scheme not allowed")

	default:
		// Treat as a bare CID (no scheme).
		if err := validateCIDChars(rawURI); err != nil {
			return "", fmt.Errorf("unrecognised URI scheme or invalid CID: %w", err)
		}
		return gateway + rawURI, nil
	}
}

// validateCIDChars checks that the string looks like a valid CIDv0 (Qm…) or
// CIDv1 (b…). We do a cheap character-set check — full CID parsing is not
// needed because we never trust the value to perform local operations; it only
// goes into a URL path segment.
func validateCIDChars(cid string) error {
	if len(cid) < 7 || len(cid) > 128 {
		return fmt.Errorf("CID length out of range (%d chars)", len(cid))
	}
	for _, c := range cid {
		alnum := (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9')
		if !alnum {
			return fmt.Errorf("invalid character %q in CID", c)
		}
	}
	return nil
}

// validateHTTPSHost ensures the target URL resolves to a public IP.
func validateHTTPSHost(rawURL string) error {
	u, err := url.Parse(rawURL)
	if err != nil {
		return fmt.Errorf("invalid URL: %w", err)
	}
	host := u.Hostname()
	if host == "" {
		return fmt.Errorf("empty host in URL")
	}
	addrs, err := net.LookupHost(host) // #nosec G704 -- this IS the SSRF validator; private IPs are rejected below
	if err != nil {
		// If we can't resolve the host, reject it conservatively
		return fmt.Errorf("cannot resolve host %q: %w", host, err)
	}
	for _, addr := range addrs {
		ip := net.ParseIP(addr)
		if ip == nil {
			continue
		}
		if isPrivateIP(ip) {
			return fmt.Errorf("host %q resolves to a private/reserved IP (%s)", host, addr)
		}
	}
	return nil
}

// validateRedirect re-applies the SSRF guards on every redirect hop. The initial
// URL is validated by resolveIPFSURI/validateHTTPSHost, but Go's HTTP client
// follows redirects without re-checking — so a malicious gateway could
// 30x-redirect the unauthenticated proxy into a private/metadata host. Refuse
// non-https hops and any host resolving to a private/reserved IP, and cap the
// chain length.
func validateRedirect(req *http.Request, via []*http.Request) error {
	if len(via) >= maxNFTRedirects {
		return fmt.Errorf("stopped after %d redirects", maxNFTRedirects)
	}
	if req.URL.Scheme != "https" {
		return fmt.Errorf("refusing redirect to non-https URL %q", req.URL.Redacted())
	}
	if err := validateHTTPSHost(req.URL.String()); err != nil {
		return fmt.Errorf("refusing redirect: %w", err)
	}
	return nil
}

// ──────────────────────────────────────────────────────────────────────────────
// Shared fetch helper
// ──────────────────────────────────────────────────────────────────────────────

// safeDialContext closes the DNS-rebinding TOCTOU between validateHTTPSHost
// (which resolves at validation time) and the actual fetch (which would resolve
// again): it resolves the host, rejects any private/reserved IP, and dials the
// SAME validated IP — so a short-TTL record can't swap a public IP for a private
// one between the check and the connect. Applied to every dial (initial + each
// redirect hop), making the IP guard authoritative at connect time.
func safeDialContext(ctx context.Context, network, addr string) (net.Conn, error) {
	host, port, err := net.SplitHostPort(addr)
	if err != nil {
		return nil, err
	}
	ips, err := net.DefaultResolver.LookupIPAddr(ctx, host)
	if err != nil {
		return nil, fmt.Errorf("cannot resolve host %q: %w", host, err)
	}
	dialer := &net.Dialer{Timeout: nftFetchTimeout}
	var lastErr error
	for _, ip := range ips {
		if isPrivateIP(ip.IP) {
			lastErr = fmt.Errorf("host %q resolves to a private/reserved IP (%s)", host, ip.IP)
			continue
		}
		conn, derr := dialer.DialContext(ctx, network, net.JoinHostPort(ip.IP.String(), port))
		if derr == nil {
			return conn, nil
		}
		lastErr = derr
	}
	if lastErr == nil {
		lastErr = fmt.Errorf("no usable address for host %q", host)
	}
	return nil, lastErr
}

// safeTransport clones the default transport and pins every dial to safeDialContext.
func safeTransport() *http.Transport {
	t := http.DefaultTransport.(*http.Transport).Clone()
	t.DialContext = safeDialContext
	return t
}

// nftHTTPClient is a package-level client used for production fetches.
// Tests replace it via newNFTImageHandler / newNFTMetadataHandler options.
// CheckRedirect re-validates every redirect hop, and safeTransport pins each dial
// to a validated public IP, so the unauthenticated proxy can't be 30x-redirected
// or DNS-rebound into a private/metadata host (SSRF; SEC-4 closes the rebind gap).
var nftHTTPClient = &http.Client{
	Timeout:       nftFetchTimeout,
	CheckRedirect: validateRedirect,
	Transport:     safeTransport(),
}

// fetchIPFS fetches a resolved URL with the given client, caps the response
// size, and returns the raw body + detected content type.
// On primary failure it tries the fallback gateway automatically when the
// original URL starts with the primary gateway prefix and the two gateways differ.
func fetchIPFS(client *http.Client, resolvedURL, primaryGateway, fbGateway string) (body []byte, contentType string, err error) {
	body, contentType, err = doFetch(client, resolvedURL)
	if err == nil {
		return body, contentType, nil
	}
	// Attempt fallback only when the URL came from the primary gateway and the
	// fallback is a different host (prevents redundant retries in tests).
	if strings.HasPrefix(resolvedURL, primaryGateway) && primaryGateway != fbGateway {
		fallbackURL := fbGateway + strings.TrimPrefix(resolvedURL, primaryGateway)
		slog.Warn("primary IPFS gateway failed, trying fallback", "primary", primaryGateway, "fallback", fallbackURL, "err", err)
		body, contentType, err = doFetch(client, fallbackURL)
	}
	return body, contentType, err
}

// doFetch performs the actual HTTP GET. target has already been validated by
// resolveIPFSURI + validateHTTPSHost which reject private IPs and disallowed
// schemes — G704 taint warnings here are false positives.
func doFetch(client *http.Client, target string) ([]byte, string, error) {
	req, err := http.NewRequest(http.MethodGet, target, nil) // #nosec G704 -- target validated by resolveIPFSURI/validateHTTPSHost before reaching doFetch
	if err != nil {
		return nil, "", fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("User-Agent", "memba-nft-proxy/1.0")

	resp, err := client.Do(req) // #nosec G704 -- target validated by resolveIPFSURI/validateHTTPSHost before reaching doFetch
	if err != nil {
		return nil, "", fmt.Errorf("fetch %s: %w", target, err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		return nil, "", fmt.Errorf("upstream %s returned %d", target, resp.StatusCode)
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, maxNFTResponseSize))
	if err != nil {
		return nil, "", fmt.Errorf("read body: %w", err)
	}

	ct := resp.Header.Get("Content-Type")
	if ct == "" {
		ct = "application/octet-stream"
	}
	return body, ct, nil
}

// ──────────────────────────────────────────────────────────────────────────────
// Handler options (injected in tests to avoid real network calls)
// ──────────────────────────────────────────────────────────────────────────────

// nftHandlerOptions holds injectable dependencies for both handlers.
type nftHandlerOptions struct {
	httpClient      *http.Client // injected HTTP client (nil → use nftHTTPClient)
	gateway         string       // injected primary gateway base URL (empty → env/default)
	fallbackGateway string       // injected fallback gateway (empty → package default)
}

// resolvedClient returns the HTTP client to use.
func (o nftHandlerOptions) resolvedClient() *http.Client {
	if o.httpClient != nil {
		return o.httpClient
	}
	return nftHTTPClient
}

// resolvedGateway returns the primary gateway base URL to use.
func (o nftHandlerOptions) resolvedGateway() string {
	if o.gateway != "" {
		return o.gateway
	}
	return ipfsGatewayURL()
}

// resolvedFallback returns the fallback gateway URL to use.
func (o nftHandlerOptions) resolvedFallback() string {
	if o.fallbackGateway != "" {
		return o.fallbackGateway
	}
	return fallbackGateway
}

// ──────────────────────────────────────────────────────────────────────────────
// GET /api/nft/image
// ──────────────────────────────────────────────────────────────────────────────

// HandleNFTImage handles GET /api/nft/image
//
// Query params (exactly one required):
//   - cid=<bare CID>          — e.g. QmXxx or bafy…
//   - uri=<ipfs:// or https://> — full URI form
//
// Response:
//   - 200 with the image bytes, Content-Type mirrored from upstream
//   - Cache-Control: public, max-age=86400, immutable (IPFS content is content-addressed)
//   - ETag: "<cid-or-uri>"
//   - X-Cache: HIT | MISS
func HandleNFTImage(opts ...nftHandlerOptions) http.Handler {
	var o nftHandlerOptions
	if len(opts) > 0 {
		o = opts[0]
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
			return
		}

		raw := r.URL.Query().Get("uri")
		if raw == "" {
			raw = r.URL.Query().Get("cid")
		}
		if raw == "" {
			http.Error(w, `{"error":"uri or cid parameter required"}`, http.StatusBadRequest)
			return
		}

		gateway := o.resolvedGateway()
		fetchURL, err := resolveIPFSURI(raw, gateway)
		if err != nil {
			slog.Warn("nft image: invalid URI", "raw", raw, "err", err)
			http.Error(w, fmt.Sprintf(`{"error":%q}`, "invalid URI: "+err.Error()), http.StatusBadRequest)
			return
		}

		cacheKey := raw

		// Cache hit
		if entry, ok := nftImageCache.get(cacheKey); ok {
			serveEntry(w, entry, "HIT", true)
			return
		}

		// Cache miss — fetch
		client := o.resolvedClient()
		body, ct, err := fetchIPFS(client, fetchURL, gateway, o.resolvedFallback())
		if err != nil {
			slog.Warn("nft image fetch failed", "url", fetchURL, "err", err)
			http.Error(w, `{"error":"upstream fetch failed"}`, http.StatusBadGateway)
			return
		}

		entry := cacheEntry{
			body:        body,
			contentType: ct,
			etag:        `"` + cacheKey + `"`,
			fetchedAt:   time.Now(),
		}
		nftImageCache.set(cacheKey, entry)
		serveEntry(w, entry, "MISS", true)
	})
}

// ──────────────────────────────────────────────────────────────────────────────
// GET /api/nft/metadata
// ──────────────────────────────────────────────────────────────────────────────

// HandleNFTMetadata handles GET /api/nft/metadata
//
// Query params:
//   - uri=<ipfs:// or https://>  (required) — IPFS or HTTPS URI pointing to JSON
//
// Response:
//   - 200 JSON with the metadata; the "image" field is rewritten to
//     /api/nft/image?uri=<original-image-uri> so the frontend always hits the
//     reliable proxy instead of raw IPFS gateways.
//   - Cache-Control: public, max-age=86400, immutable
//   - ETag: "<uri>"
//   - X-Cache: HIT | MISS
func HandleNFTMetadata(opts ...nftHandlerOptions) http.Handler {
	var o nftHandlerOptions
	if len(opts) > 0 {
		o = opts[0]
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
			return
		}

		raw := r.URL.Query().Get("uri")
		if raw == "" {
			http.Error(w, `{"error":"uri parameter required"}`, http.StatusBadRequest)
			return
		}

		gateway := o.resolvedGateway()
		fetchURL, err := resolveIPFSURI(raw, gateway)
		if err != nil {
			slog.Warn("nft metadata: invalid URI", "raw", raw, "err", err)
			http.Error(w, fmt.Sprintf(`{"error":%q}`, "invalid URI: "+err.Error()), http.StatusBadRequest)
			return
		}

		cacheKey := raw

		// Cache hit
		if entry, ok := nftMetadataCache.get(cacheKey); ok {
			serveEntry(w, entry, "HIT", false)
			return
		}

		// Fetch + parse
		client := o.resolvedClient()
		body, _, err := fetchIPFS(client, fetchURL, gateway, o.resolvedFallback())
		if err != nil {
			slog.Warn("nft metadata fetch failed", "url", fetchURL, "err", err)
			http.Error(w, `{"error":"upstream fetch failed"}`, http.StatusBadGateway)
			return
		}

		// Parse as a generic JSON map so we forward unknown fields.
		var raw2 map[string]json.RawMessage
		if err := json.Unmarshal(body, &raw2); err != nil {
			slog.Warn("nft metadata: invalid JSON from upstream", "url", fetchURL, "err", err)
			http.Error(w, `{"error":"upstream returned invalid JSON"}`, http.StatusBadGateway)
			return
		}

		// Rewrite the "image" field so the frontend hits our proxy.
		if imgRaw, ok := raw2["image"]; ok {
			var imgURI string
			if json.Unmarshal(imgRaw, &imgURI) == nil && imgURI != "" {
				proxied := "/api/nft/image?uri=" + url.QueryEscape(imgURI)
				if rewritten, err := json.Marshal(proxied); err == nil {
					raw2["image"] = rewritten
				}
			}
		}

		rewritten, err := json.Marshal(raw2)
		if err != nil {
			slog.Warn("nft metadata: failed to re-marshal", "err", err)
			http.Error(w, `{"error":"internal error"}`, http.StatusInternalServerError)
			return
		}

		entry := cacheEntry{
			body:        rewritten,
			contentType: "application/json; charset=utf-8",
			etag:        `"` + cacheKey + `"`,
			fetchedAt:   time.Now(),
		}
		nftMetadataCache.set(cacheKey, entry)
		serveEntry(w, entry, "MISS", false)
	})
}

// ──────────────────────────────────────────────────────────────────────────────
// Shared response helper
// ──────────────────────────────────────────────────────────────────────────────

// serveEntry writes a cached entry to the response.
//
// When mediaResponse is true the entry is attacker-influenced IPFS/NFT media: we
// harden it against content-type sniffing (S-F1). The upstream Content-Type is
// mirrored only when it is an image/* type; anything else (notably text/html or
// image/svg+xml, which browsers can execute) is served as application/octet-stream
// instead of echoed. We also send X-Content-Type-Options: nosniff and
// Content-Disposition: inline so the body can never render as an active page on the
// API origin. Non-media callers (metadata) serve a self-generated Content-Type and
// pass false.
func serveEntry(w http.ResponseWriter, e cacheEntry, cacheStatus string, mediaResponse bool) {
	contentType := e.contentType
	if mediaResponse {
		contentType = safeImageContentType(contentType)
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Content-Disposition", "inline")
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Cache-Control", "public, max-age=86400, immutable")
	w.Header().Set("ETag", e.etag)
	w.Header().Set("X-Cache", cacheStatus)
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(e.body)
}

// safeImageContentType returns ct unchanged when it denotes a raster image type,
// and application/octet-stream otherwise. SVG is treated as non-image because it is
// an XSS vector (it can carry <script>). This prevents an attacker-controlled
// upstream Content-Type (e.g. text/html) from being mirrored to the API origin.
func safeImageContentType(ct string) string {
	// Strip any parameters (e.g. "image/png; charset=binary") before matching.
	mediaType := strings.ToLower(strings.TrimSpace(ct))
	if i := strings.IndexByte(mediaType, ';'); i >= 0 {
		mediaType = strings.TrimSpace(mediaType[:i])
	}
	switch mediaType {
	case "image/png", "image/jpeg", "image/gif", "image/webp", "image/avif", "image/apng", "image/bmp", "image/x-icon", "image/vnd.microsoft.icon":
		return ct
	default:
		return "application/octet-stream"
	}
}
