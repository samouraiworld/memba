/** Per-article head meta + BlogPosting JSON-LD (next-cycle plan Wave 0.3). */
import { describe, it, expect, afterEach } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { applyArticleHeadMeta, clearArticleHeadMeta } from "./blogMeta"
import { staticBlogArticleHtml } from "./staticBlogHtml"
import { osSiteHtml } from "../os/osSiteIdentity"
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

    it("keeps canonical, OG and structured URLs clear of tracking and fragments", () => {
        applyArticleHeadMeta(article, "https://memba.club/os/news/inside-memba/?utm_source=feed#heading")
        const expected = "https://memba.club/os/news/inside-memba"
        expect(document.head.querySelector('link[rel="canonical"]')?.getAttribute("href")).toBe(expected)
        expect(meta('meta[property="og:url"]')).toBe(expected)
        expect(JSON.parse(document.getElementById("memba-blog-posting")!.textContent!).mainEntityOfPage).toBe(expected)
    })

    it("clearArticleHeadMeta removes article-only tags when no prior tag existed", () => {
        applyArticleHeadMeta(article, "https://x.test/a")
        clearArticleHeadMeta()
        expect(document.getElementById("memba-blog-posting")).toBeNull()
        expect(meta('meta[property="og:type"]')).toBeUndefined()
        expect(meta('meta[property="og:title"]')).toBeUndefined()
    })

    it("is idempotent — reapplying updates in place, never duplicates nodes", () => {
        applyArticleHeadMeta(article, "https://x.test/a")
        applyArticleHeadMeta({ ...article, title: "Second" }, "https://x.test/b")
        expect(document.head.querySelectorAll('meta[property="og:title"]')).toHaveLength(1)
        expect(document.head.querySelectorAll("#memba-blog-posting")).toHaveLength(1)
        expect(meta('meta[property="og:title"]')).toBe("Second — Memba")
    })

    it("restores OS identity and title after a News article closes", () => {
        document.head.innerHTML = '<meta name="description" content="OS home"><meta property="og:title" content="Memba OS"><meta property="og:description" content="OS home"><meta property="og:type" content="website"><meta property="og:url" content="https://memba.club/os"><meta name="twitter:title" content="Memba OS"><meta name="twitter:description" content="OS home"><link rel="canonical" href="https://memba.club/os">'
        document.title = "Memba OS"
        applyArticleHeadMeta({ ...article, updated: "2026-09-28" }, "https://memba.club/os/news/inside-memba")
        expect(document.title).toBe("Inside Memba — Memba")
        expect(meta('meta[property="og:url"]')).toBe("https://memba.club/os/news/inside-memba")
        expect(JSON.parse(document.getElementById("memba-blog-posting")!.textContent!).dateModified).toBe("2026-09-28")
        clearArticleHeadMeta()
        expect(document.title).toBe("Memba OS")
        expect(meta('meta[name="description"]')).toBe("OS home")
        expect(meta('meta[property="og:title"]')).toBe("Memba OS")
        expect(meta('meta[property="og:description"]')).toBe("OS home")
        expect(meta('meta[property="og:type"]')).toBe("website")
        expect(meta('meta[property="og:url"]')).toBe("https://memba.club/os")
        expect(meta('meta[name="twitter:title"]')).toBe("Memba OS")
        expect(meta('meta[name="twitter:description"]')).toBe("OS home")
        expect(document.head.querySelector('link[rel="canonical"]')?.getAttribute("href")).toBe("https://memba.club/os")
        expect(document.getElementById("memba-blog-posting")).toBeNull()
    })

    it("does not overwrite a newer route's head writes during cleanup", () => {
        document.title = "Memba OS"
        applyArticleHeadMeta(article, "https://memba.club/os/news/inside-memba")
        document.title = "Other route"
        document.head.querySelector('meta[property="og:title"]')!.setAttribute("content", "Other route")
        clearArticleHeadMeta()
        expect(document.title).toBe("Other route")
        expect(meta('meta[property="og:title"]')).toBe("Other route")
    })

    it("restores the beta identity after a directly loaded OS article backgrounds", () => {
        const source = readFileSync(resolve(import.meta.dirname, "../../index.html"), "utf-8")
        const url = "https://memba.club/os/news/inside-memba"
        const shell = staticBlogArticleHtml(osSiteHtml(source), article, url)
        const parsed = new DOMParser().parseFromString(shell, "text/html")
        document.head.innerHTML = parsed.head.innerHTML
        expect(meta('meta[property="og:title"]')).toBe("Inside Memba — Memba")
        applyArticleHeadMeta(article, url)
        clearArticleHeadMeta()
        expect(document.title).toBe("Memba OS — A home for gno.land.")
        expect(meta('meta[name="description"]')).toBe("A home for gno.land. Explore apps, communities and tools in Memba OS. Public Beta on mainnet.")
        expect(meta('meta[property="og:title"]')).toBe("Memba OS — A home for gno.land.")
        expect(meta('meta[property="og:type"]')).toBe("website")
        expect(meta('meta[property="og:url"]')).toBe("https://memba.club/")
        expect(meta('meta[property="article:published_time"]')).toBeUndefined()
        expect(document.head.querySelector('link[rel="canonical"]')?.getAttribute("href")).toBe("https://memba.club/")
        expect(document.getElementById("memba-blog-posting")).toBeNull()
    })
})
