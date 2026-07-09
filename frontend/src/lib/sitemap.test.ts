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

describe("buildSitemapXml — dynamic entries (blog articles)", () => {
    it("appends extra entries with their own lastmod after the static routes", () => {
        const xml = buildSitemapXml(undefined, undefined, undefined, "2026-07-09", [
            { path: "/blog/inside-memba", lastmod: "2026-07-04" },
            { path: "/blog/no-date" },
        ])
        expect((xml.match(/<url>/g) || [])).toHaveLength(SITEMAP_PATHS.length + 2)
        expect(xml).toContain(`<loc>${SITE_ORIGIN}/${SITEMAP_NETWORK}/blog/inside-memba</loc>`)
        // The article's own date wins over the build date…
        const article = xml.slice(xml.indexOf("/blog/inside-memba"))
        expect(article).toContain("<lastmod>2026-07-04</lastmod>")
        // …and an entry without one falls back to the build date.
        const fallback = xml.slice(xml.indexOf("/blog/no-date"))
        expect(fallback).toContain("<lastmod>2026-07-09</lastmod>")
    })

    it("escapes XML-special characters in extra paths", () => {
        const xml = buildSitemapXml("https://x.test", "net", [], undefined, [{ path: "/blog/a&b" }])
        expect(xml).toContain("<loc>https://x.test/net/blog/a&amp;b</loc>")
    })
})
