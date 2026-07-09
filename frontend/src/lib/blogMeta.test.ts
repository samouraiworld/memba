/** Per-article head meta + BlogPosting JSON-LD (next-cycle plan Wave 0.3). */
import { describe, it, expect, afterEach } from "vitest"
import { applyArticleHeadMeta, clearArticleHeadMeta } from "./blogMeta"
import type { BlogArticle } from "./blogParser"

const article: BlogArticle = {
    slug: "inside-memba",
    title: "Inside Memba",
    date: "2026-07-04",
    description: "A tour of everything live on test13.",
    tags: ["memba", "gno"],
    body: "…",
}

const meta = (sel: string) => document.head.querySelector(sel)?.getAttribute("content")

afterEach(() => {
    clearArticleHeadMeta()
    document.head.querySelectorAll("meta, link").forEach(n => n.remove())
})

describe("applyArticleHeadMeta", () => {
    it("writes the article's own description/OG/twitter meta", () => {
        applyArticleHeadMeta(article, "https://memba.samourai.app/test13/blog/inside-memba")
        expect(meta('meta[name="description"]')).toBe(article.description)
        expect(meta('meta[property="og:title"]')).toBe("Inside Memba — Memba")
        expect(meta('meta[property="og:description"]')).toBe(article.description)
        expect(meta('meta[property="og:type"]')).toBe("article")
        expect(meta('meta[name="twitter:title"]')).toBe("Inside Memba — Memba")
    })

    it("injects a BlogPosting JSON-LD record", () => {
        applyArticleHeadMeta(article, "https://x.test/test13/blog/inside-memba")
        const node = document.getElementById("memba-blog-posting")
        expect(node).not.toBeNull()
        const data = JSON.parse(node!.textContent ?? "{}")
        expect(data["@type"]).toBe("BlogPosting")
        expect(data.headline).toBe("Inside Memba")
        expect(data.datePublished).toBe("2026-07-04")
        expect(data.mainEntityOfPage).toBe("https://x.test/test13/blog/inside-memba")
    })

    it("clearArticleHeadMeta removes the JSON-LD and restores og:type=website", () => {
        applyArticleHeadMeta(article, "https://x.test/a")
        clearArticleHeadMeta()
        expect(document.getElementById("memba-blog-posting")).toBeNull()
        expect(meta('meta[property="og:type"]')).toBe("website")
    })

    it("is idempotent — reapplying updates in place, never duplicates nodes", () => {
        applyArticleHeadMeta(article, "https://x.test/a")
        applyArticleHeadMeta({ ...article, title: "Second" }, "https://x.test/b")
        expect(document.head.querySelectorAll('meta[property="og:title"]')).toHaveLength(1)
        expect(document.head.querySelectorAll("#memba-blog-posting")).toHaveLength(1)
        expect(meta('meta[property="og:title"]')).toBe("Second — Memba")
    })
})
