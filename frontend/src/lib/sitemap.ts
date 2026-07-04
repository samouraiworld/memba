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

/** Render the sitemap XML. `lastmod` = ISO date (YYYY-MM-DD), injected by the
 *  caller (the build plugin passes the build date). */
export function buildSitemapXml(
    origin: string = SITE_ORIGIN,
    network: string = SITEMAP_NETWORK,
    paths: readonly string[] = SITEMAP_PATHS,
    lastmod?: string,
): string {
    const urls = paths.map(p => {
        const loc = escapeXml(`${origin}/${network}${p === "/" ? "/" : p}`)
        return [
            "  <url>",
            `    <loc>${loc}</loc>`,
            ...(lastmod ? [`    <lastmod>${lastmod}</lastmod>`] : []),
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
