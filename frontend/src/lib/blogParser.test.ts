/** W6.4 — blog front-matter parser + RSS builder. */
import { describe, it, expect } from "vitest"
import { parseBlogArticle, parseBlogArticles, slugFromPath, buildRssXml } from "./blogParser"

const RAW = `---
title: Hello Gno
date: 2026-07-04
description: A first post.
tags: memba, gno
---
Body **here**.
`

describe("parseBlogArticle", () => {
    it("parses front-matter + body + slug", () => {
        const a = parseBlogArticle("content/blog/2026-07-04-hello-gno.md", RAW)!
        expect(a.slug).toBe("hello-gno")
        expect(a.title).toBe("Hello Gno")
        expect(a.date).toBe("2026-07-04")
        expect(a.tags).toEqual(["memba", "gno"])
        expect(a.body).toBe("Body **here**.")
    })

    it("rejects articles missing required fields (fail per-article)", () => {
        expect(parseBlogArticle("x.md", "no front matter")).toBeNull()
        expect(parseBlogArticle("x.md", "---\ntitle: T\n---\nbody")).toBeNull()
        expect(parseBlogArticle("x.md", "---\ntitle: T\ndate: yesterday\n---\nbody")).toBeNull()
    })

    it("slugFromPath strips date prefix and extension only", () => {
        expect(slugFromPath("a/b/2026-01-02-my-post.md")).toBe("my-post")
        expect(slugFromPath("plain.md")).toBe("plain")
    })
})

describe("parseBlogArticles", () => {
    it("sorts newest first and drops invalid files", () => {
        const out = parseBlogArticles({
            "2026-01-01-old.md": RAW.replace("2026-07-04", "2026-01-01"),
            "2026-07-04-new.md": RAW,
            "broken.md": "not an article",
        })
        expect(out.map(a => a.slug)).toEqual(["new", "old"])
        expect(out[0].date).toBe("2026-07-04")
    })
})

describe("buildRssXml", () => {
    it("emits valid RSS with escaped fields and permalink guids", () => {
        const a = parseBlogArticle("2026-07-04-x.md", RAW.replace("Hello Gno", "A <b> & title"))!
        const xml = buildRssXml("https://x.test", "net", [a])
        expect(xml).toContain("<rss version=\"2.0\">")
        expect(xml).toContain("<title>A &lt;b&gt; &amp; title</title>")
        expect(xml).toContain("<link>https://x.test/net/blog/x</link>")
        expect(xml).toContain("<pubDate>Sat, 04 Jul 2026 00:00:00 GMT</pubDate>")
    })
})

describe("the shipped article set", () => {
    it("every content/blog article parses (drift tripwire on the real files)", async () => {
        const { readdirSync, readFileSync } = await import("node:fs")
        const { resolve } = await import("node:path")
        const dir = resolve(__dirname, "../../content/blog")
        const files = readdirSync(dir).filter(f => f.endsWith(".md"))
        expect(files.length).toBeGreaterThanOrEqual(1)
        for (const f of files) {
            const a = parseBlogArticle(f, readFileSync(resolve(dir, f), "utf-8"))
            expect(a, `${f} failed the front-matter contract`).not.toBeNull()
            expect(a!.description.length).toBeGreaterThan(40)
        }
    })
})
