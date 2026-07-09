/**
 * sitemap — W6.3 PR2: build-time sitemap.xml generation.
 *
 * PURE module (no React, no import.meta.env at module scope) so
 * vite.config.ts can import it in the node build context: a tiny plugin
 * calls buildSitemapXml() on closeBundle and writes dist/sitemap.xml.
 *
 * Scope decision (deliberate): STATIC public routes only. The roadmap's
 * "hybrid" option (top-N DAOs/tokens fetched at build) would couple every
 * Netlify build to live-chain availability — a flaky-build tax we're not
 * paying for marginal crawl coverage; crawlers discover entity pages through
 * the listed section pages. Revisit alongside the W6.3 PR3 prerender
 * decision if entity-page indexing proves weak.
 */

/** Canonical public origin (matches index.html og:url + netlify.toml). */
export const SITE_ORIGIN = "https://memba.samourai.app"

/** Network prefix baked into public URLs. Bump on default-network change
 *  (single source for the sitemap; runtime code derives its own). */
export const SITEMAP_NETWORK = "test13"

/**
 * Public, indexable, STATIC routes (network-relative). Auth-gated pages
 * (dashboard, multisig, settings…) and parameterized detail pages are
 * deliberately excluded. Keep in sync with lib/routeMeta.ts sections.
 */
export const SITEMAP_PATHS: readonly string[] = [
    "/",
    "/dao",
    "/tokens",
    "/directory",
    "/validators",
    "/validators/hacker",
    "/marketplace",
    "/quests",
    "/feed",
    "/leaderboard",
    "/gnolove",
    "/changelogs",
    "/extensions",
    "/blog",
    "/feedback",
]

function escapeXml(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

/** A dynamic sitemap entry with its own lastmod (e.g. a blog article: the
 *  article date is a truthful lastmod, unlike the build date). */
export interface SitemapEntry {
    /** network-relative path, e.g. "/blog/inside-memba" */
    path: string
    /** ISO date (YYYY-MM-DD); falls back to the build-wide lastmod */
    lastmod?: string
}

/** Render the sitemap XML. `lastmod` = ISO date (YYYY-MM-DD), injected by the
 *  caller (the build plugin passes the build date). `extra` appends dynamic
 *  entries (blog articles) after the static routes, each with its own lastmod. */
export function buildSitemapXml(
    origin: string = SITE_ORIGIN,
    network: string = SITEMAP_NETWORK,
    paths: readonly string[] = SITEMAP_PATHS,
    lastmod?: string,
    extra: readonly SitemapEntry[] = [],
): string {
    const entries: SitemapEntry[] = [
        ...paths.map(p => ({ path: p, lastmod })),
        ...extra.map(e => ({ path: e.path, lastmod: e.lastmod ?? lastmod })),
    ]
    const urls = entries.map(({ path, lastmod: mod }) => {
        const loc = escapeXml(`${origin}/${network}${path === "/" ? "/" : path}`)
        return [
            "  <url>",
            `    <loc>${loc}</loc>`,
            ...(mod ? [`    <lastmod>${mod}</lastmod>`] : []),
            "  </url>",
        ].join("\n")
    })
    return [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        ...urls,
        "</urlset>",
        "",
    ].join("\n")
}
