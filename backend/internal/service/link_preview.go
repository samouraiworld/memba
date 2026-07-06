package service

// Rich link previews (feed Item 3). GetLinkPreview fetches OpenGraph/Twitter-card
// metadata for an external URL server-side, and the image is proxied through a
// signed token so the reader's browser never talks to third-party hosts. The
// fetch is SSRF-guarded by the shared helpers in ipfs_serve.go (validateHTTPSHost,
// validateRedirect, safeTransport — DNS-rebind-safe at dial time). Gated OFF by
// default behind MEMBA_ENABLE_LINK_PREVIEWS; returns ok=false (never an error) so
// the UI silently falls back to a plain link card.
//
// Security design + review checklist: docs/planning/FEED_LINK_PREVIEWS_DESIGN_2026-07-06.md

import (
	"context"
	"crypto/ed25519"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"html"
	"io"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"connectrpc.com/connect"
	membav1 "github.com/samouraiworld/memba/backend/gen/memba/v1"
)

const (
	linkPreviewUA       = "MembaLinkPreview/1.0 (+https://memba.samourai.app)"
	linkPreviewTimeout  = 5 * time.Second
	maxLinkPreviewBytes = 512 << 10 // 512 KB of HTML (metadata lives in <head>)
	maxLinkImageBytes   = 2 << 20   // 2 MB image cap on the proxy
	imageTokenTTL       = 6 * 3600  // seconds a proxy token stays valid
	linkPosTTL          = 6 * 3600  // positive cache TTL (seconds)
	linkNegTTL          = 30 * 60   // negative cache TTL (seconds)
	linkCacheMax        = 10_000    // LRU-ish bound so unique-URL spam can't grow it unbounded
)

func linkPreviewsEnabled() bool { return os.Getenv("MEMBA_ENABLE_LINK_PREVIEWS") == "true" }

// linkMeta is the parsed metadata subset we render.
type linkMeta struct {
	Title       string
	Description string
	SiteName    string
	ImageURL    string
	ImageWidth  int
	ImageHeight int
}

// ── OpenGraph / Twitter-card parser ───────────────────────────────────────────

var (
	reMetaTag = regexp.MustCompile(`(?is)<meta\b[^>]*>`)
	reProp    = regexp.MustCompile(`(?is)\bproperty\s*=\s*["']([^"']*)["']`)
	reName    = regexp.MustCompile(`(?is)\bname\s*=\s*["']([^"']*)["']`)
	reContent = regexp.MustCompile(`(?is)\bcontent\s*=\s*["']([^"']*)["']`)
	reTitle   = regexp.MustCompile(`(?is)<title[^>]*>(.*?)</title>`)
)

func metaAttr(re *regexp.Regexp, tag string) string {
	if m := re.FindStringSubmatch(tag); m != nil {
		return m[1]
	}
	return ""
}

// parseOpenGraph extracts OG/Twitter-card fields (with a <title> fallback) from
// an HTML document. Attribute order is not assumed. Values are HTML-unescaped.
// Pure and deterministic.
func parseOpenGraph(htmlDoc string) linkMeta {
	var m linkMeta
	for _, tag := range reMetaTag.FindAllString(htmlDoc, -1) {
		key := metaAttr(reProp, tag)
		if key == "" {
			key = metaAttr(reName, tag)
		}
		if key == "" {
			continue
		}
		content := metaAttr(reContent, tag)
		if content == "" {
			continue
		}
		content = strings.TrimSpace(html.UnescapeString(content))
		switch strings.ToLower(key) {
		case "og:title", "twitter:title":
			if m.Title == "" {
				m.Title = content
			}
		case "og:description", "twitter:description", "description":
			if m.Description == "" {
				m.Description = content
			}
		case "og:site_name":
			if m.SiteName == "" {
				m.SiteName = content
			}
		case "og:image", "og:image:url", "og:image:secure_url", "twitter:image", "twitter:image:src":
			if m.ImageURL == "" {
				m.ImageURL = content
			}
		case "og:image:width":
			m.ImageWidth = atoiClamp(content)
		case "og:image:height":
			m.ImageHeight = atoiClamp(content)
		}
	}
	if m.Title == "" {
		if t := reTitle.FindStringSubmatch(htmlDoc); t != nil {
			m.Title = strings.TrimSpace(html.UnescapeString(t[1]))
		}
	}
	return m
}

func atoiClamp(s string) int {
	n, err := strconv.Atoi(strings.TrimSpace(s))
	if err != nil || n < 0 || n > 100_000 {
		return 0
	}
	return n
}

// ── URL validation (SSRF gate) ────────────────────────────────────────────────

// validateLinkPreviewURL enforces the scheme/port allowlist and rejects any host
// that resolves to a private/reserved IP (reusing validateHTTPSHost). Returns the
// normalized URL. The authoritative rebind-safe check is at dial time in
// safeTransport; this is the first, cheap gate.
func validateLinkPreviewURL(raw string) (string, error) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return "", fmt.Errorf("invalid URL: %w", err)
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return "", fmt.Errorf("scheme %q not allowed", u.Scheme)
	}
	if u.Hostname() == "" {
		return "", fmt.Errorf("empty host")
	}
	if p := u.Port(); p != "" && p != "80" && p != "443" {
		return "", fmt.Errorf("port %q not allowed", p)
	}
	if err := validateHTTPSHost(u.String()); err != nil { // resolve + reject private IPs
		return "", err
	}
	return u.String(), nil
}

// absoluteURL resolves a possibly-relative image URL against the page URL.
func absoluteURL(base, ref string) string {
	b, err := url.Parse(base)
	if err != nil {
		return ref
	}
	r, err := url.Parse(strings.TrimSpace(ref))
	if err != nil {
		return ref
	}
	return b.ResolveReference(r).String()
}

// ── Image-proxy token (HMAC over the vetted image URL + expiry) ────────────────

// linkImageHMACKey derives a stable, domain-separated HMAC key from the server's
// ed25519 seed — no new secret to provision, and unusable as the auth key.
func linkImageHMACKey(priv ed25519.PrivateKey) []byte {
	h := sha256.Sum256(append([]byte("memba-link-image-proxy-v1\x00"), priv.Seed()...))
	return h[:]
}

func signImageToken(priv ed25519.PrivateKey, imageURL string, exp int64) string {
	payload := strconv.FormatInt(exp, 10) + ":" + imageURL
	mac := hmac.New(sha256.New, linkImageHMACKey(priv))
	mac.Write([]byte(payload))
	return base64.RawURLEncoding.EncodeToString([]byte(payload)) + "." +
		base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func verifyImageToken(priv ed25519.PrivateKey, token string, now int64) (string, error) {
	dot := strings.IndexByte(token, '.')
	if dot <= 0 {
		return "", fmt.Errorf("malformed token")
	}
	payload, err := base64.RawURLEncoding.DecodeString(token[:dot])
	if err != nil {
		return "", fmt.Errorf("bad payload encoding")
	}
	sig, err := base64.RawURLEncoding.DecodeString(token[dot+1:])
	if err != nil {
		return "", fmt.Errorf("bad signature encoding")
	}
	mac := hmac.New(sha256.New, linkImageHMACKey(priv))
	mac.Write(payload)
	if !hmac.Equal(sig, mac.Sum(nil)) {
		return "", fmt.Errorf("signature mismatch")
	}
	expStr, imageURL, ok := strings.Cut(string(payload), ":")
	if !ok {
		return "", fmt.Errorf("bad payload format")
	}
	exp, err := strconv.ParseInt(expStr, 10, 64)
	if err != nil {
		return "", fmt.Errorf("bad expiry")
	}
	if now > exp {
		return "", fmt.Errorf("token expired")
	}
	return imageURL, nil
}

// ── Hardened HTTP client (shared SSRF transport + redirect re-validation) ──────

var linkPreviewClient = &http.Client{
	Timeout:       linkPreviewTimeout,
	CheckRedirect: validateRedirect, // per-hop re-validation + redirect cap (ipfs_serve.go)
	Transport:     safeTransport(),  // DNS-rebind-safe dial to a validated public IP
}

func allowedImageType(ct string) bool {
	ct = strings.ToLower(strings.TrimSpace(strings.SplitN(ct, ";", 2)[0]))
	switch ct {
	case "image/png", "image/jpeg", "image/webp", "image/gif":
		return true
	}
	return false // explicitly excludes image/svg+xml (XSS vector) and everything else
}

// fetchLinkPreview fetches the (already-validated) URL and parses its metadata.
func (s *MultisigService) fetchLinkPreview(ctx context.Context, validatedURL string) (linkMeta, error) {
	ctx, cancel := context.WithTimeout(ctx, linkPreviewTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, validatedURL, nil)
	if err != nil {
		return linkMeta{}, err
	}
	req.Header.Set("User-Agent", linkPreviewUA)
	req.Header.Set("Accept", "text/html,application/xhtml+xml")
	resp, err := linkPreviewClient.Do(req)
	if err != nil {
		return linkMeta{}, err
	}
	defer resp.Body.Close() //nolint:errcheck
	if resp.StatusCode != http.StatusOK {
		return linkMeta{}, fmt.Errorf("status %d", resp.StatusCode)
	}
	ct := strings.ToLower(resp.Header.Get("Content-Type"))
	if !strings.HasPrefix(ct, "text/html") && !strings.HasPrefix(ct, "application/xhtml") {
		return linkMeta{}, fmt.Errorf("unexpected content-type %q", ct)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxLinkPreviewBytes))
	if err != nil {
		return linkMeta{}, err
	}
	return parseOpenGraph(string(body)), nil
}

// ── Bounded TTL cache (positive + negative) ────────────────────────────────────

type linkCacheEntry struct {
	resp *membav1.GetLinkPreviewResponse
	exp  int64
}

type linkCache struct {
	mu sync.Mutex
	m  map[string]linkCacheEntry
}

var linkPreviewCache = &linkCache{m: make(map[string]linkCacheEntry)}

func (c *linkCache) get(key string, now int64) (*membav1.GetLinkPreviewResponse, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	e, ok := c.m[key]
	if !ok || now > e.exp {
		return nil, false
	}
	return e.resp, true
}

func (c *linkCache) put(key string, resp *membav1.GetLinkPreviewResponse, ttl, now int64) {
	c.mu.Lock()
	defer c.mu.Unlock()
	// Crude bound: when full, drop the whole map rather than track LRU order.
	// Simple and safe against unique-URL spam; entries repopulate on demand.
	if len(c.m) >= linkCacheMax {
		c.m = make(map[string]linkCacheEntry, linkCacheMax)
	}
	c.m[key] = linkCacheEntry{resp: resp, exp: now + ttl}
}

// ── RPC + image proxy handlers ─────────────────────────────────────────────────

func (s *MultisigService) GetLinkPreview(ctx context.Context, req *connect.Request[membav1.GetLinkPreviewRequest]) (*connect.Response[membav1.GetLinkPreviewResponse], error) {
	notOK := func() *connect.Response[membav1.GetLinkPreviewResponse] {
		return connect.NewResponse(&membav1.GetLinkPreviewResponse{Ok: false})
	}
	if !linkPreviewsEnabled() {
		return notOK(), nil
	}
	canonical, err := validateLinkPreviewURL(req.Msg.Url)
	if err != nil {
		return notOK(), nil // best-effort; a preview is never surfaced as an error
	}
	now := time.Now().Unix()
	if cached, ok := linkPreviewCache.get(canonical, now); ok {
		return connect.NewResponse(cached), nil
	}

	meta, err := s.fetchLinkPreview(ctx, canonical)
	if err != nil {
		neg := &membav1.GetLinkPreviewResponse{Ok: false}
		linkPreviewCache.put(canonical, neg, linkNegTTL, now)
		return connect.NewResponse(neg), nil
	}

	resp := &membav1.GetLinkPreviewResponse{
		Ok:           true,
		Title:        meta.Title,
		Description:  meta.Description,
		SiteName:     meta.SiteName,
		CanonicalUrl: canonical,
		ImageWidth:   int32(meta.ImageWidth),
		ImageHeight:  int32(meta.ImageHeight),
	}
	if meta.ImageURL != "" {
		if imgURL, e := validateLinkPreviewURL(absoluteURL(canonical, meta.ImageURL)); e == nil {
			resp.ImageToken = signImageToken(s.privateKey, imgURL, now+imageTokenTTL)
		}
	}
	linkPreviewCache.put(canonical, resp, linkPosTTL, now)
	return connect.NewResponse(resp), nil
}

// HandleLinkImage proxies an og:image the preview step already vetted. The signed
// token authorizes exactly one image URL; the URL is re-validated here (rebind
// defense), the type is allowlisted, the body is size-capped, and the response
// carries no-sniff + CSP:none so it can never be served as active content.
func (s *MultisigService) HandleLinkImage() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !linkPreviewsEnabled() {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		imgURL, err := verifyImageToken(s.privateKey, r.URL.Query().Get("t"), time.Now().Unix())
		if err != nil {
			http.Error(w, "invalid token", http.StatusBadRequest)
			return
		}
		if _, err := validateLinkPreviewURL(imgURL); err != nil { // re-validate at serve time
			http.Error(w, "blocked", http.StatusBadRequest)
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), linkPreviewTimeout)
		defer cancel()
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, imgURL, nil)
		if err != nil {
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}
		req.Header.Set("User-Agent", linkPreviewUA)
		resp, err := linkPreviewClient.Do(req)
		if err != nil {
			http.Error(w, "fetch failed", http.StatusBadGateway)
			return
		}
		defer resp.Body.Close() //nolint:errcheck
		if resp.StatusCode != http.StatusOK {
			http.Error(w, "upstream error", http.StatusBadGateway)
			return
		}
		ct := resp.Header.Get("Content-Type")
		if !allowedImageType(ct) {
			http.Error(w, "unsupported media type", http.StatusUnsupportedMediaType)
			return
		}
		w.Header().Set("Content-Type", ct)
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Content-Security-Policy", "default-src 'none'")
		w.Header().Set("Cache-Control", "public, max-age=86400")
		_, _ = io.Copy(w, io.LimitReader(resp.Body, maxLinkImageBytes))
	})
}
