import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { staticBlogArticleHtml } from "./staticBlogHtml"
import { osSiteHtml } from "../os/osSiteIdentity"
import type { BlogArticle } from "./blogParser"

const source = readFileSync(resolve(import.meta.dirname, "../../index.html"), "utf-8")
const article: BlogArticle = {
    slug: "inside-memba", title: 'A "quoted" <post> & more', date: "2026-07-04", updated: "2026-09-28",
    description: 'An <article> about "Memba" & friends.', tags: ["memba", "gno"], body: "Body",
}

describe("staticBlogArticleHtml", () => {
    it("emits a classic article identity while preserving the app shell and CSP", () => {
        const canonical = "https://memba.samourai.app/mainnet/blog/inside-memba"
        const html = staticBlogArticleHtml(source, article, canonical)
        const doc = new DOMParser().parseFromString(html, "text/html")
        expect(doc.title).toBe(`${article.title} — Memba`)
        expect(doc.querySelector('meta[name="description"]')?.getAttribute("content")).toBe(article.description)
        expect(doc.querySelector('meta[property="og:title"]')?.getAttribute("content")).toBe(`${article.title} — Memba`)
        expect(doc.querySelector('meta[property="og:description"]')?.getAttribute("content")).toBe(article.description)
        expect(doc.querySelector('meta[property="og:type"]')?.getAttribute("content")).toBe("article")
        expect(doc.querySelector('meta[property="og:url"]')?.getAttribute("content")).toBe(canonical)
        expect(doc.querySelector('meta[property="og:image"]')?.getAttribute("content")).toBe("https://memba.samourai.app/og-image.jpg")
        expect(doc.querySelector('link[rel="canonical"]')?.getAttribute("href")).toBe(canonical)
        expect(doc.querySelector('meta[property="article:published_time"]')?.getAttribute("content")).toBe(article.date)
        expect(doc.querySelectorAll('meta[name="description"]')).toHaveLength(1)
        expect(doc.querySelectorAll('meta[property="og:title"]')).toHaveLength(1)
        expect(doc.querySelectorAll('meta[name="twitter:title"]')).toHaveLength(1)
        expect(doc.querySelector('meta[http-equiv="Content-Security-Policy"]')).not.toBeNull()
        expect(doc.querySelector('#root')).not.toBeNull()
        expect(doc.querySelector('script[type="module"]')?.getAttribute("src")).toBe("/src/main.tsx")
        const posting = JSON.parse(doc.querySelector("#memba-blog-posting")!.textContent!)
        expect(posting.headline).toBe(article.title)
        expect(posting.datePublished).toBe(article.date)
        expect(posting.dateModified).toBe(article.updated)
        expect(posting.mainEntityOfPage).toBe(canonical)
    })

    it("keeps beta artwork and safely encodes HTML and JSON-LD", () => {
        const dangerous = { ...article, title: '</script><script>alert("x")</script>' }
        const html = staticBlogArticleHtml(osSiteHtml(source), dangerous, "https://memba.club/os/news/inside-memba")
        const doc = new DOMParser().parseFromString(html, "text/html")
        expect(doc.querySelector('meta[property="og:image"]')?.getAttribute("content")).toBe("https://memba.club/brand/os/share-1200x630.png")
        expect(doc.querySelectorAll("#memba-blog-posting")).toHaveLength(1)
        expect(JSON.parse(doc.querySelector("#memba-blog-posting")!.textContent!).headline).toBe(dangerous.title)
        expect(html).not.toContain('</script><script>alert("x")')
        expect(doc.querySelector('link[rel="canonical"]')?.getAttribute("href")).toBe("https://memba.club/os/news/inside-memba")
    })
})
