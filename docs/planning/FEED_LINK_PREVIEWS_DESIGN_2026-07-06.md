# Feed rich link previews — design & security spec (2026-07-06)

Status: **DESIGN — awaiting security sign-off before implementation.**
Owner action: review §4 (SSRF threat model) and §10 (security checklist), then approve to build.

Roadmap context: Item 3 of the social-feed Wave-2 plan (see `SOCIAL_FEED_UX_REVIEW_AND_DESIGN_2026-07-06.md`). The typed on-chain cards (token / validator / proposal) already ship; this adds **rich previews for ordinary external URLs** — the plain "link" unfurl becomes a thumbnail card with title, description, site name, and image.

This feature makes the **backend fetch attacker-influenced URLs**, so it is security-critical. It is designed to be **off by default** behind a flag and to ship only after the review in §10.

---

## 1. Goal & scope

- **Goal:** a pasted `https://example.com/article` renders a rich card — title, description, site name, and a thumbnail — instead of just a host + "Open" link.
- **In scope:** an OG/Twitter-card metadata fetch (server-side), an **image proxy** so the browser never talks to third-party hosts, a server-side cache, and a frontend thumbnail card with no layout shift.
- **Non-goals (this pass):** full-page screenshots, oEmbed/embeds, JS-rendered previews (headless browser), video. The on-chain typed cards (token/validator/proposal) are unchanged and take precedence over this generic path.

## 2. Why server-side (and why it's risky)

The browser can't read a third-party page's `<meta>` (CORS), and we **don't want** the client hitting arbitrary hosts (privacy — the Samourai ethos; a reader's IP must not leak to every link author's server). So the **backend** fetches metadata and **proxies the image**. That means the backend performs HTTP requests to URLs chosen by untrusted posters → classic **SSRF** surface. §4 is the core of this document.

## 3. Architecture

```
Poster's body ──parse──> feedUnfurl { kind:"link", url }         (existing)
                                        │
Frontend PostUnfurls  ── GetLinkPreview(url) ──> Backend RPC ─┐
   (skeleton → card)  <── {title,desc,siteName,imageProxyUrl} ┘
                                        │  (SSRF-guarded fetch + parse + cache)
   <img src={imageProxyUrl}> ── GET /api/link-image?token=… ──> Backend proxy
                                        │  (re-fetch og:image, SSRF-guarded, size/type-capped, cached)
```

Two backend endpoints:
1. **`GetLinkPreview(url) → LinkPreview`** — ConnectRPC method (added to `api/memba/v1/memba.proto`). Fetches the HTML, parses OG/Twitter/`<title>` metadata, returns text fields + an **opaque, signed image token** (never the raw third-party image URL).
2. **`GET /api/link-image?t=<signed-token>`** — plain HTTP handler that re-fetches the `og:image` (SSRF-guarded again, independently), streams it back with a capped size and an allowlisted content-type. The token is an HMAC of the resolved image URL (+ expiry), so the proxy only serves images the preview step already vetted — the client can't pivot the proxy to arbitrary URLs.

Both endpoints share one hardened HTTP client (§4) and one cache (§6).

## 4. SSRF threat model & mitigations (the critical part)

**Threat:** a poster supplies a URL that makes the backend connect to something it shouldn't — cloud metadata (`169.254.169.254`), internal services (`10.0.0.0/8`, `127.0.0.1`, `localhost`, Fly.io internal `*.internal` / `fdaa:*`), or a redirect/DNS-rebind that starts public and flips to private.

**Mitigations (defense in depth — all required):**

1. **Scheme allowlist:** `http` / `https` only. Reject `file:`, `ftp:`, `gopher:`, `data:`, etc.
2. **Port allowlist:** 80 / 443 only. No `:22`, `:6379`, `:3306`, arbitrary ports.
3. **Resolve-then-validate at dial time (DNS-rebind-safe):** the `http.Transport` uses a custom `DialContext` whose `net.Dialer.Control` runs on **the actual IP being dialed**, after DNS resolution, and rejects it if it's in any denied range. This is the ONLY reliable rebind defense — validating the hostname or a pre-resolved IP is bypassable (TOCTOU: resolver returns public IP for the check, private IP for the real dial). We validate the socket's real remote IP in `Control`.
4. **Denied IP ranges** (v4 + v6): loopback `127.0.0.0/8` `::1`, link-local `169.254.0.0/16` `fe80::/10`, cloud metadata `169.254.169.254` + `fd00:ec2::254`, private `10/8` `172.16/12` `192.168/16` `fc00::/7` (ULA — covers Fly `fdaa:`), unspecified `0.0.0.0` `::`, broadcast, multicast, and CGNAT `100.64/10`. Use a vetted denylist; reject `!ip.IsGlobalUnicast() || ip.IsPrivate()` plus the explicit extras.
5. **Redirect cap + re-validation:** follow at most **3** redirects; **every** hop re-runs the full scheme/port/IP validation (a `CheckRedirect` that re-validates, plus the `Control` fires per dial anyway). No auto-follow to a fresh unvalidated target.
6. **Time budget:** connect timeout 3 s, total request timeout 5 s (`context.WithTimeout`), so a slow-loris/internal-hang can't tie up workers.
7. **Size budget:** read at most **512 KB** of HTML via `io.LimitReader` (metadata lives in `<head>`; we can stop early once `</head>` is seen). Image proxy caps at **2 MB**.
8. **Content-type checks:** preview fetch requires `text/html` (or `application/xhtml+xml`); image proxy requires `image/(png|jpeg|webp|gif)` — sniffed **and** header-checked, reject SVG (XSS vector) and everything else.
9. **No credentials / no cookies:** requests carry a fixed `User-Agent` (identifies the Memba preview bot), `no` cookies, `no` auth headers, and do not forward the poster's identity.
10. **Response headers on the proxy:** `Content-Security-Policy: default-src 'none'`, `X-Content-Type-Options: nosniff`, `Content-Disposition: inline`, a strict `Content-Type`, and cache headers. Never `Content-Type: text/html` from the image proxy.

> **Note on `Control`:** Go's `net.Dialer.Control(network, address, RawConn)` receives the resolved `address` (`ip:port`) that is about to be dialed. Parse the IP there and return an error to abort the connection if denied. This runs for the connection to the final host on every redirect hop — the correct rebind-safe hook.

## 5. Proto contract (additive, non-breaking)

```proto
// GetLinkPreview fetches OpenGraph/Twitter-card metadata for an external URL,
// server-side and SSRF-guarded. No auth (read-only, no funds). Rate-limited.
rpc GetLinkPreview(GetLinkPreviewRequest) returns (GetLinkPreviewResponse);

message GetLinkPreviewRequest { string url = 1; }
message GetLinkPreviewResponse {
  bool     ok            = 1;  // false → frontend shows today's plain link card
  string   title         = 2;
  string   description   = 3;
  string   site_name     = 4;
  string   canonical_url = 5;  // resolved/canonical (post-redirect), for display
  string   image_token   = 6;  // opaque, signed; "" if no usable image
  int32    image_width   = 7;  // from og:image:width if present (for aspect ratio)
  int32    image_height  = 8;
}
```
`ok=false` (or any RPC error) → the frontend silently falls back to the existing plain link card. No error is ever surfaced to the reader; a preview is best-effort.

## 6. Caching

- **Key:** the normalized request URL (scheme+host+path+query, lowercased host). **Positive TTL** ~6 h, **negative TTL** ~30 min (so a transient failure isn't sticky, and a hostile URL isn't re-fetched on every render).
- **Where:** the existing backend cache layer (same as other read caches). Cache the parsed `LinkPreviewResponse` (text + token), and separately cache the proxied image bytes (keyed by resolved image URL) with the size cap.
- **Stampede control:** single-flight per URL so N posts linking the same article cause one upstream fetch.
- **Abuse cap:** a global LRU bound (e.g. 10 k entries) so the cache can't be grown unbounded by spamming unique URLs.

## 7. Rate limiting

- Per-client (IP / session) token bucket on `GetLinkPreview` — previews are cheap to request but cause an outbound fetch, so cap e.g. 20/min/client. The image proxy is served from cache for the common case; uncached proxy fetches share the same outbound budget.
- A global outbound concurrency semaphore so a burst can't exhaust the fetch worker pool.

## 8. Frontend

- `PostUnfurls`: for a `link` ref, call `GetLinkPreview(url)` via react-query (skeleton while loading).
  - **`ok` + image:** a thumbnail card — image on a **fixed aspect-ratio box** (from `image_width/height`, default 1.91:1 OG ratio) so there is **no CLS**; title (1–2 lines, clamped), description (2 lines, clamped), site name. Image `src` = the proxy URL; `loading="lazy"`, `referrerpolicy="no-referrer"`, `onError` → collapse to the text-only variant.
  - **`ok`, no image:** a text-only rich card (title + desc + site).
  - **`!ok` / error / flag off:** today's plain link card (host + "Open"). **Never a blank/broken card.**
- No third-party network from the client — the image loads from our proxy only.
- Cap: still bounded by `MAX_UNFURLS` (3) per post; on-chain typed cards take precedence over generic link previews.

## 9. Flag & rollout

- Backend behind `MEMBA_ENABLE_LINK_PREVIEWS` (env, default off) — the RPC returns `ok=false` when disabled, so the frontend degrades to plain cards with zero visual change.
- Frontend behind the same `VITE_ENABLE_FEED` (previews are part of the feed) plus a sub-flag `VITE_ENABLE_LINK_PREVIEWS` for independent enablement.
- Rollout: enable on staging → verify the §10 checklist against a battery of hostile URLs → enable in prod only after the security review signs off.

## 10. Security review checklist (the gate)

Build is **not** done until every box is verified with a test:

- [ ] `file://`, `ftp://`, `gopher://`, `data:` → rejected.
- [ ] `http://127.0.0.1`, `http://localhost`, `http://[::1]` → rejected.
- [ ] `http://169.254.169.254/latest/meta-data/` (AWS/GCP metadata) → rejected.
- [ ] Fly internal `http://<app>.internal`, `fdaa:*`/`fd00::/8` targets → rejected.
- [ ] `10.*`, `172.16–31.*`, `192.168.*`, `100.64.*` → rejected.
- [ ] A public URL that **302-redirects** to `127.0.0.1` / metadata → rejected at the redirect dial.
- [ ] **DNS-rebind:** a hostname resolving public on first lookup, private at dial → rejected in `Control` (unit test with a controlled resolver / a `Control` that inspects the dialed IP).
- [ ] Non-80/443 ports (`:22`, `:6379`) → rejected.
- [ ] Oversized body (> 512 KB HTML / > 2 MB image) → truncated/rejected, no OOM.
- [ ] Slow-loris / hanging host → times out at 5 s, worker freed.
- [ ] Image proxy refuses non-image and `image/svg+xml`; sets `nosniff` + `CSP default-src 'none'`.
- [ ] Proxy token is unforgeable (HMAC) and scoped to the vetted image URL + expiry; a tampered/`&t=` swap → 400.
- [ ] Rate limit + single-flight + cache LRU bound verified under a spam burst.
- [ ] No cookies/credentials/poster identity forwarded upstream; fixed bot UA.

## 11. Test plan

- **Backend unit:** the URL/IP validator (table-driven over the §10 cases), the redirect re-validation, the `Control` rebind guard (with a fake dialer), the metadata parser (OG / Twitter / bare `<title>` / missing), the token HMAC sign/verify, the size/type caps.
- **Backend integration:** an in-process malicious test server (redirects, oversized, wrong content-type, slow) asserting each is handled; a golden OG page asserting parsed fields.
- **Frontend:** `PostUnfurls` renders the thumbnail card on `ok`, the text card on `ok`-no-image, and the plain fallback on `!ok` — with a fixed aspect-ratio box (no CLS). react-query mocked; TDD.
- **No silent caps:** log (not swallow) when a preview is refused for a safety reason, so ops can see abuse patterns.

## 12. Open questions for the owner

1. **Ship image proxy in v1, or text-only first?** Text-only (no image) removes the 2 MB image-fetch surface and the proxy endpoint entirely — a smaller first step. Recommendation: **text-only v1**, add the proxied image in a fast-follow once the fetch guard is proven in prod.
2. **Allowlist vs. denylist hosts?** Denylist-by-IP-range (this doc) previews any public site. An optional **host allowlist** (known-good domains) would be stricter but limits the feature. Recommendation: IP-range denylist + the full §4 stack; revisit an allowlist only if abuse appears.
3. **Where does the fetch run?** Same backend process (simple, shares cache) vs. an isolated egress worker (blast-radius containment). Recommendation: same process v1 with the §4 guards; isolate later if the feed opens to untrusted growth (which is itself gated on the moderation lever).
