/**
 * blogOnchain + blogSource merge — the on-chain blog read path (backlog item 8).
 *
 * Pins: qeval JSON mapping onto the static BlogArticle shape, the slug
 * injection guard, excerpt derivation, and the union rule (on-chain wins its
 * slug, static-only slugs survive, realm outage falls back to static).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const mockQueryEval = vi.fn()
vi.mock("./dao/shared", async (importOriginal) => ({
    ...(await importOriginal<typeof import("./dao/shared")>()),
    queryEval: (...args: unknown[]) => mockQueryEval(...args),
}))
vi.mock("./config", async (importOriginal) => ({
    ...(await importOriginal<typeof import("./config")>()),
    isOnchainBlogEnabled: () => true,
}))

import { fetchOnchainArticle, fetchOnchainArticles, excerptOf } from "./blogOnchain"
import { mergeArticles } from "./blogSource"
import type { BlogArticle } from "./blogParser"

/** Wrap a JSON payload exactly the way vm/qeval returns a realm string:
 * ("<go-quoted-json>" string). */
const qeval = (json: string) => `(${JSON.stringify(json)} string)`

const META = { slug: "why-memba", title: "Why Memba", author: "g1ed", tags: "thesis,dao", date: "2026-07-01", createdBlk: 100, updatedBlk: 100 }

beforeEach(() => mockQueryEval.mockReset())

describe("fetchOnchainArticle", () => {
    it("maps the realm JSON onto the static BlogArticle shape", async () => {
        mockQueryEval.mockResolvedValueOnce(qeval(JSON.stringify({ ...META, body: "Intro paragraph.\n\n## Section" })))
        const a = await fetchOnchainArticle("why-memba")
        expect(a).toMatchObject({
            slug: "why-memba",
            title: "Why Memba",
            date: "2026-07-01",
            source: "onchain",
            tags: ["thesis", "dao"],
            body: "Intro paragraph.\n\n## Section",
        })
        expect(a!.description).toBe("Intro paragraph.")
        expect(mockQueryEval).toHaveBeenCalledWith(expect.any(String), expect.any(String), 'GetPostJSON("why-memba")', true)
    })

    it("never interpolates a non-kebab slug into the qeval expression", async () => {
        const a = await fetchOnchainArticle('x") or Steal("')
        expect(a).toBeNull()
        expect(mockQueryEval).not.toHaveBeenCalled()
    })

    it("returns null on unknown/unpublished ('' from the realm) or transport failure", async () => {
        mockQueryEval.mockResolvedValueOnce(qeval(""))
        expect(await fetchOnchainArticle("gone")).toBeNull()
        mockQueryEval.mockRejectedValueOnce(new Error("rpc down"))
        expect(await fetchOnchainArticle("gone")).toBeNull()
    })

    it("rejects a mismatched slug or impossible calendar date", async () => {
        mockQueryEval.mockResolvedValueOnce(qeval(JSON.stringify({ ...META, slug: "another-post", body: "Wrong post" })))
        expect(await fetchOnchainArticle("why-memba")).toBeNull()
        mockQueryEval.mockResolvedValueOnce(qeval(JSON.stringify({ ...META, date: "2026-02-30", body: "Wrong date" })))
        expect(await fetchOnchainArticle("why-memba")).toBeNull()
    })
})

describe("fetchOnchainArticles", () => {
    it("fetches all complete pages and their bodies with strict reads", async () => {
        const firstPage = Array.from({ length: 50 }, (_, i) => ({ ...META, slug: `post-${i}` }))
        mockQueryEval.mockImplementation(async (...args: unknown[]) => {
            const expr = String(args[2] ?? "")
            if (expr === "GetPostsPage(0, 50)") return qeval(JSON.stringify(firstPage))
            if (expr === "GetPostsPage(50, 50)") return qeval(JSON.stringify([{ ...META, slug: "post-50" }]))
            const slug = /^GetPostJSON\("([a-z0-9-]+)"\)$/.exec(expr)?.[1]
            return slug ? qeval(JSON.stringify({ ...META, slug, body: `Body for ${slug}` })) : null
        })
        const list = await fetchOnchainArticles()
        expect(list).toHaveLength(51)
        expect(list![50].slug).toBe("post-50")
        expect(mockQueryEval).toHaveBeenCalledWith(expect.any(String), expect.any(String), "GetPostsPage(50, 50)", true)
        expect(mockQueryEval.mock.calls.every(call => call[3] === true)).toBe(true)
    })

    it("falls back on an invalid page or any missing body", async () => {
        mockQueryEval.mockResolvedValueOnce(qeval(JSON.stringify([{ ...META, slug: "valid" }, { ...META, slug: "INVALID" }])))
        expect(await fetchOnchainArticles()).toBeNull()
        mockQueryEval.mockImplementation(async (...args: unknown[]) => {
            const expr = String(args[2] ?? "")
            if (expr.startsWith("GetPostsPage")) return qeval(JSON.stringify([META, { ...META, slug: "second-post" }]))
            if (expr === 'GetPostJSON("why-memba")') return qeval(JSON.stringify({ ...META, body: "Body A" }))
            return qeval("")
        })
        expect(await fetchOnchainArticles()).toBeNull()
    })

    it("does not publish an uncertain 200-post cap", async () => {
        mockQueryEval.mockImplementation(async (...args: unknown[]) => {
            const offset = /^GetPostsPage\((\d+), 50\)$/.exec(String(args[2] ?? ""))?.[1]
            return qeval(JSON.stringify(Array.from({ length: 50 }, (_, i) => ({ ...META, slug: `post-${Number(offset) + i}` }))))
        })
        expect(await fetchOnchainArticles()).toBeNull()
        expect(mockQueryEval).toHaveBeenCalledTimes(4)
        expect(mockQueryEval.mock.calls.some(call => String(call[2]).startsWith("GetPostJSON"))).toBe(false)
    })

    it("limits body reads to four concurrent requests", async () => {
        let active = 0
        let peak = 0
        mockQueryEval.mockImplementation(async (...args: unknown[]) => {
            const expr = String(args[2] ?? "")
            if (expr.startsWith("GetPostsPage")) {
                return qeval(JSON.stringify(Array.from({ length: 9 }, (_, i) => ({ ...META, slug: `post-${i}` }))))
            }
            const slug = /^GetPostJSON\("([a-z0-9-]+)"\)$/.exec(expr)?.[1]
            active++
            peak = Math.max(peak, active)
            await new Promise(resolve => setTimeout(resolve, 1))
            active--
            return qeval(JSON.stringify({ ...META, slug, body: "Body" }))
        })
        expect(await fetchOnchainArticles()).toHaveLength(9)
        expect(peak).toBe(4)
    })

    it("returns null (→ static fallback) when the realm is unreachable", async () => {
        // The real queryEval reports transport failure as null (abciQuery
        // swallows); a hard rejection must ALSO fall back. Once-variants only —
        // the persistent mocks leave an eagerly-stored rejection unhandled.
        mockQueryEval.mockResolvedValueOnce(null)
        expect(await fetchOnchainArticles()).toBeNull()
        mockQueryEval.mockRejectedValueOnce(new Error("rpc down"))
        expect(await fetchOnchainArticles()).toBeNull()
    })
})

describe("mergeArticles (union rule)", () => {
    const art = (slug: string, date: string, title: string): BlogArticle =>
        ({ slug, date, title, description: "", tags: [], body: "b" })

    it("on-chain wins its slug; static-only slugs survive; newest-first", () => {
        const merged = mergeArticles(
            [art("shared", "2026-07-05", "Onchain rev")],
            [art("shared", "2026-07-01", "Static old"), art("static-only", "2026-07-03", "Static only")],
        )
        expect(merged.map(a => a.slug)).toEqual(["shared", "static-only"])
        expect(merged[0].title).toBe("Onchain rev")
    })

    it("outage (null) and empty realm fall back to static wholesale", () => {
        const statics = [art("a", "2026-07-01", "A")]
        expect(mergeArticles(null, statics)).toBe(statics)
        expect(mergeArticles([], statics)).toBe(statics)
    })
})

describe("excerptOf", () => {
    it("skips headings/images, strips markdown, and truncates", () => {
        expect(excerptOf("# H1\n\n![img](x.png)\n\nReal **bold** [link](u) text.")).toBe("Real bold link text.")
        expect(excerptOf("word ".repeat(100), 20).endsWith("…")).toBe(true)
    })
})
