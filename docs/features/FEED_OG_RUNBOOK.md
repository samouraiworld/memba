# Feed OG crawler card — runbook

The Netlify Edge Function `frontend/netlify/edge-functions/feed-og.ts` gives feed
permalinks (`/feed/post/:id`) a real Open Graph card for link-unfurl crawlers
(X, Telegram, Discord, Slack, WhatsApp, LinkedIn, Google/Bing). Humans are passed
straight through to the SPA. This is the A1.2 leg of the Feed v2 plan (§8 Moat #3
distribution loop).

## Why an edge function (not `blogMeta` / client OG)

The app is a client-rendered SPA. A crawler that doesn't run JS sees only the
static `index.html` OG tags (generic "Memba — Gno Multisig & DAO Governance").
The edge function runs server-side at the CDN and can render per-post tags the
crawler actually reads.

## Where it lives (deploy topology)

`netlify.toml` sets `base = "frontend"`, so Netlify auto-discovers edge functions
at **`frontend/netlify/edge-functions/`**, not the repo root. The path is declared
in-source (`export const config = { path: "/feed/post/:id" }`); **`netlify.toml`
is intentionally untouched** (no CSP / redirect / header risk). The edge function
runs before the SPA `/*` rewrite.

## Safety — moderated content can never leak (P0)

`renderOgPage` (in `frontend/src/lib/feedOg.ts`) is the single chokepoint:

- **Hidden** (flag auto-hide — body is *retained* in the DB as an audit trail) →
  generic "no longer available" card, body suppressed.
- **Deleted / mod-removed** (`body=''`) → same generic card.
- **Blocklisted** → `GetFeedThread` returns 404 → edge function falls through to
  the SPA (no card).
- **Any error / timeout / non-200** → falls through to the SPA (fail-open).

This mirrors `PostCard` L207–216 exactly. Covered by
`frontend/src/lib/feedOg.test.ts` (P0 tombstone cases) +
`frontend/netlify/edge-functions/feed-og.test.ts` (handler routing).

## Verification (no local Deno harness — verify on a deploy preview)

1. Open a deploy preview (Netlify builds one per PR once the branch is pushed and
   Netlify's Git integration is enabled for previews).
2. Bot UA gets a card:
   ```
   curl -s -A 'Twitterbot/1.0' https://<preview-url>/feed/post/1 | grep 'og:'
   ```
   Expect `og:title`, `og:description` (the post body), `og:url`, `og:image`.
3. Human UA gets the SPA (no server card):
   ```
   curl -s -A 'Mozilla/5.0 (iPhone; ...) Safari/604.1' https://<preview-url>/feed/post/1 | grep -c '<div id="root">'
   ```
   Expect the normal app shell.
4. Tombstone never leaks — pick a hidden/deleted post id and confirm the bot card
   says "no longer available" with **no** body text.
5. Not-found id falls through:
   ```
   curl -s -A 'Twitterbot/1.0' https://<preview-url>/feed/post/99999999 | grep -c 'og:description'
   ```
   Expect the generic SPA (no per-post description).
6. Validate the card in the platform debuggers: X Card Validator, Telegram
   `@WebpageBot`, the Facebook Sharing Debugger, `https://www.opengraph.xyz`.

## Notes / follow-ups

- `og:image` currently points at the static `/og-image.jpg`. A per-post rendered
  image (Satori/resvg on the edge) is a deliberate later step — the static image
  is safe and always correct; dynamic image rendering adds cost + a surface where
  a tombstoned body could be re-introduced, so it is out of scope for A1.2.
- The client-side canvas share card (A1.3) is the complementary vector for users
  actively sharing to X/Telegram; this edge function is for passive link unfurls.
