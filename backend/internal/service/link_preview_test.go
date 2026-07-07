package service

import (
	"crypto/ed25519"
	"crypto/rand"
	"strings"
	"testing"
)

// ── OpenGraph parser ──────────────────────────────────────────────────────────

func TestParseOpenGraph_ExtractsOGFields(t *testing.T) {
	html := `<html><head>
		<meta property="og:title" content="The Title">
		<meta property="og:description" content="A description here">
		<meta property="og:site_name" content="Example">
		<meta property="og:image" content="https://cdn.example.com/pic.png">
		<meta property="og:image:width" content="1200">
		<meta property="og:image:height" content="630">
		<title>Fallback Title</title>
	</head><body>...</body></html>`
	m := parseOpenGraph(html)
	if m.Title != "The Title" {
		t.Fatalf("title = %q", m.Title)
	}
	if m.Description != "A description here" {
		t.Fatalf("description = %q", m.Description)
	}
	if m.SiteName != "Example" {
		t.Fatalf("siteName = %q", m.SiteName)
	}
	if m.ImageURL != "https://cdn.example.com/pic.png" {
		t.Fatalf("imageURL = %q", m.ImageURL)
	}
	if m.ImageWidth != 1200 || m.ImageHeight != 630 {
		t.Fatalf("image dims = %dx%d", m.ImageWidth, m.ImageHeight)
	}
}

func TestParseOpenGraph_FallsBackToTitleTagAndTwitter(t *testing.T) {
	html := `<head>
		<title>Plain &amp; Simple</title>
		<meta name="twitter:description" content="tw desc">
		<meta name="twitter:image" content="https://x.example/y.jpg">
	</head>`
	m := parseOpenGraph(html)
	if m.Title != "Plain & Simple" { // HTML entity decoded
		t.Fatalf("title = %q", m.Title)
	}
	if m.Description != "tw desc" {
		t.Fatalf("description = %q", m.Description)
	}
	if m.ImageURL != "https://x.example/y.jpg" {
		t.Fatalf("imageURL = %q", m.ImageURL)
	}
}

func TestParseOpenGraph_EmptyOnNoMeta(t *testing.T) {
	m := parseOpenGraph(`<html><body>no head meta</body></html>`)
	if m.Title != "" || m.ImageURL != "" {
		t.Fatalf("expected empty meta, got %+v", m)
	}
}

// ── URL validation (SSRF gate, §4/§10) ────────────────────────────────────────

func TestValidateLinkPreviewURL_RejectsUnsafe(t *testing.T) {
	bad := []string{
		"file:///etc/passwd",
		"ftp://example.com/x",
		"gopher://example.com",
		"data:text/html,hi",
		"http://127.0.0.1/x",
		"http://localhost/x",
		"http://[::1]/x",
		"http://169.254.169.254/latest/meta-data/", // cloud metadata
		"http://10.0.0.5/x",
		"http://192.168.1.1/x",
		"http://172.16.0.1/x",
		"http://example.com:22/x",   // disallowed port
		"http://example.com:6379/x", // disallowed port
		"https://",                  // empty host
		"not a url",
	}
	for _, u := range bad {
		if _, err := validateLinkPreviewURL(u); err == nil {
			t.Errorf("expected rejection for %q", u)
		}
	}
}

func TestValidateLinkPreviewURL_AllowsPublicHTTPS(t *testing.T) {
	// A public literal IP passes (no DNS needed → no network flakiness in CI).
	got, err := validateLinkPreviewURL("https://8.8.8.8/article?a=1")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.HasPrefix(got, "https://8.8.8.8/") {
		t.Fatalf("canonical = %q", got)
	}
}

// ── Image proxy token (HMAC, §4 no-open-proxy) ────────────────────────────────

func testKey() ed25519.PrivateKey {
	_, priv, _ := ed25519.GenerateKey(rand.Reader) // random each call → wrong-key case truly differs
	return priv
}

func TestImageToken_RoundTrip(t *testing.T) {
	key := testKey()
	url := "https://cdn.example.com/pic.png"
	tok := signImageToken(key, url, 1_900_000_000)
	if tok == "" {
		t.Fatal("empty token")
	}
	got, err := verifyImageToken(key, tok, 1_800_000_000)
	if err != nil {
		t.Fatalf("verify failed: %v", err)
	}
	if got != url {
		t.Fatalf("round-trip url = %q", got)
	}
}

func TestImageToken_RejectsTamperAndExpiry(t *testing.T) {
	key := testKey()
	tok := signImageToken(key, "https://cdn.example.com/pic.png", 1_900_000_000)

	// Tampered payload → reject.
	if _, err := verifyImageToken(key, tok+"x", 1_800_000_000); err == nil {
		t.Error("expected tamper rejection")
	}
	// Wrong key → reject.
	if _, err := verifyImageToken(testKey(), tok, 1_800_000_000); err == nil {
		t.Error("expected wrong-key rejection")
	}
	// Expired (now > exp) → reject.
	if _, err := verifyImageToken(key, tok, 2_000_000_000); err == nil {
		t.Error("expected expiry rejection")
	}
}

// ── Image proxy content-type allowlist (§10: reject SVG + non-images) ──────────

func TestAllowedImageType(t *testing.T) {
	ok := []string{"image/png", "image/jpeg", "image/webp", "image/gif", "image/png; charset=binary", "IMAGE/PNG"}
	for _, ct := range ok {
		if !allowedImageType(ct) {
			t.Errorf("expected %q allowed", ct)
		}
	}
	bad := []string{"image/svg+xml", "text/html", "application/xml", "image/svg+xml; charset=utf-8", "", "application/octet-stream"}
	for _, ct := range bad {
		if allowedImageType(ct) {
			t.Errorf("expected %q rejected", ct)
		}
	}
}

func TestAbsoluteURL_ResolvesRelativeImage(t *testing.T) {
	got := absoluteURL("https://example.com/blog/post", "/img/hero.png")
	if got != "https://example.com/img/hero.png" {
		t.Fatalf("absolute = %q", got)
	}
	// Already-absolute passes through.
	if absoluteURL("https://example.com/x", "https://cdn.example.com/y.png") != "https://cdn.example.com/y.png" {
		t.Fatal("absolute passthrough failed")
	}
}
