# SEO — architecture, decisions, and maintenance

> W6.3 (Program Compound). Shipped in three slices: #744 per-route meta,
> #745 sitemap + robots, and this PR's structured data + prerender decision.

## What ships

| Layer | Mechanism | Source of truth |
|---|---|---|
| Per-route meta (description, og:*, twitter:title, canonical) | `RouteMetaSync` in Layout, applied on every navigation | `frontend/src/lib/routeMeta.ts` (ordered regex map) |
| Page titles | Per-page `document.title` (M6 pattern) — deliberately NOT centralized; parent-effect ordering would clobber dynamic titles | each page |
| `sitemap.xml` | Vite `closeBundle` plugin, emitted every build (network-prefixed, lastmod-stamped) | `frontend/src/lib/sitemap.ts` (`SITEMAP_PATHS`) |
| `robots.txt` | Static file | `frontend/public/robots.txt` |
| Site-level JSON-LD (Organization, WebApplication) | Static in `index.html` — crawler-readable without JS render | `frontend/index.html` |
| Per-route JSON-LD (BreadcrumbList) | Injected by `RouteMetaSync` | `RouteMetaSync.tsx` |

JSON-LD `<script type="application/ld+json">` blocks are inert — browsers never
execute them, so CSP `script-src` does not apply.

## Maintenance rules

- **New public static route?** Add it to `SITEMAP_PATHS` *and* `ROUTE_META` —
  a drift-tripwire test (`sitemap.test.ts`) fails if the pairing is broken.
- **Default network change?** Bump `SITEMAP_NETWORK` in `lib/sitemap.ts`.
- Flag-gated and auth-gated routes stay OUT of the sitemap until live.
- The sitemap is static-only by design: build-time chain fetches for entity
  pages would couple every Netlify build to live-chain availability.

## Prerender decision (2026-07-04) — NOT adopted, revisit at mainnet

**Decision: no prerendering layer for now.** Rationale:

1. **Googlebot renders JS reliably** (second-wave rendering). With #744's
   per-route meta, #745's sitemap, and static JSON-LD in the raw HTML, the
   crawlable surface is solid for the audience that matters at testnet stage.
2. **Netlify's built-in prerendering is legacy/beta** and not a foundation to
   build on; external services (prerender.io) add a paid dependency and a
   cache-staleness failure mode; SSR/SSG migration is out of proportion to a
   SPA whose high-value pages are chain-data-driven anyway.
3. **The static payload already covers the first wave:** title, description,
   OG tags, and Organization/WebApplication JSON-LD are all in `index.html`
   before any JS runs. What second-wave rendering adds is per-route
   refinement, not baseline visibility.

**Re-evaluation triggers** (any one): mainnet marketing push (W8.5 track);
search-console coverage showing section pages unindexed after ~4 weeks;
non-Google engines becoming a measurable traffic source; the blog (W6.4)
needing social-preview fidelity beyond what static OG tags give it.

## Verification

- Lighthouse SEO target: ≥95 on the key routes (home, /dao, /directory,
  /validators, /marketplace).
- `npm run build && head dist/sitemap.xml` — 13 URLs, network-prefixed.
- Rich-results test on `/` for the Organization/WebApplication graph.
