/** W6.3 PR2 — sitemap builder. */
import { describe, it, expect } from "vitest"
import { buildSitemapXml, SITEMAP_PATHS, SITE_ORIGIN, SITEMAP_NETWORK } from "./sitemap"

describe("buildSitemapXml", () => {
    const xml = buildSitemapXml(undefined, undefined, undefined, "2026-07-03")

    it("emits a valid urlset with every public route, network-prefixed", () => {
        expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>')
        expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">')
        expect((xml.match(/<url>/g) || [])).toHaveLength(SITEMAP_PATHS.length)
        expect(xml).toContain(`<loc>${SITE_ORIGIN}/${SITEMAP_NETWORK}/dao</loc>`)
        expect(xml).toContain(`<loc>${SITE_ORIGIN}/${SITEMAP_NETWORK}/</loc>`)
        expect(xml).toContain("<lastmod>2026-07-03</lastmod>")
    })

    it("contains no auth-gated or parameterized routes", () => {
        for (const bad of ["/dashboard", "/multisig", "/settings", "/profile", ":"]) {
            expect(xml).not.toContain(`${SITEMAP_NETWORK}${bad}`)
        }
    })

    it("escapes XML-special characters in URLs", () => {
        const x = buildSitemapXml("https://x.test", "net", ["/a&b"])
        expect(x).toContain("<loc>https://x.test/net/a&amp;b</loc>")
    })

    it("paths stay aligned with the route-meta sections (drift tripwire)", async () => {
        const { matchRouteMeta } = await import("./routeMeta")
        // Every sitemap path must resolve to a real meta payload
        // (feedback is the one intentionally-generic exception).
        for (const p of SITEMAP_PATHS) {
            if (p === "/feedback") continue
            const m = matchRouteMeta(`/${SITEMAP_NETWORK}${p === "/" ? "" : p}`, SITEMAP_NETWORK)
            expect(m.title, `no route meta for sitemap path ${p}`).toBeTruthy()
        }
    })
})
