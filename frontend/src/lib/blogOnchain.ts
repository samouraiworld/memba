/**
 * blogOnchain — read-only client for the memba_blog_v1 realm (backlog item 8).
 *
 * Reads the realm's JSON getters (`GetPostsPage`, `GetPostJSON`) via ABCI
 * `vm/qeval` and maps them onto the SAME BlogArticle shape the static
 * pipeline produces, so the /blog UI renders either source unchanged and
 * /blog/<slug> URLs stay stable across the migration.
 *
 * SECURITY: `slug` reaches `GetPostJSON("<slug>")` inside a qeval EXPRESSION —
 * it is validated against the realm's own strict kebab-case shape before
 * interpolation (mirrors appStore.ts's pkgPath handling).
 *
 * @module lib/blogOnchain
 */

import { queryEval, parseQevalJSON } from "./dao/shared"
import { GNO_RPC_URL } from "./config"
import type { BlogArticle } from "./blogParser"
import { BLOG_SLUG } from "./blogSlug"

// The active blog realm. Env-overridable (same pattern as the App Store realm)
// so a future realm version needs no code change.
export const BLOG_REALM_PATH =
    import.meta.env.VITE_BLOG_REALM_PATH || "gno.land/r/samcrew/memba_blog_v1"

const PAGE_SIZE = 50
const MAX_POSTS = 200
const BODY_CONCURRENCY = 4

function isIsoDay(value: unknown): value is string {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
    const date = new Date(`${value}T00:00:00Z`)
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

interface OnchainPostMeta {
    slug: string
    title: string
    author: string
    tags: string
    date: string
    createdBlk: number
    updatedBlk: number
}

function isMeta(v: unknown): v is OnchainPostMeta {
    if (typeof v !== "object" || v === null) return false
    const m = v as Record<string, unknown>
    return typeof m.slug === "string" && BLOG_SLUG.test(m.slug) &&
        typeof m.title === "string" && m.title.trim().length > 0 &&
        isIsoDay(m.date) && typeof m.tags === "string"
}

/** First-paragraph excerpt for list cards (the realm stores no description —
 * deriving it keeps a single source of truth: the body). */
export function excerptOf(body: string, max = 180): string {
    const firstPara = body
        .split(/\n\s*\n/)
        .map(p => p.trim())
        .find(p => p && !p.startsWith("#") && !p.startsWith("!")) ?? ""
    const plain = firstPara
        .replace(/!\[[^\]]*\]\([^)]*\)/g, "")      // images
        .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")   // links → text
        .replace(/[*_`>#]/g, "")
        .replace(/\s+/g, " ")
        .trim()
    return plain.length > max ? plain.slice(0, max - 1).trimEnd() + "…" : plain
}

function toArticle(meta: OnchainPostMeta, body: string): BlogArticle {
    return {
        slug: meta.slug,
        title: meta.title,
        date: meta.date,
        source: "onchain",
        description: excerptOf(body),
        tags: meta.tags ? meta.tags.split(",").map(t => t.trim()).filter(Boolean) : [],
        body,
    }
}

/**
 * Fetch one published on-chain article (with body), or null when the slug is
 * invalid/unknown/unpublished or the realm is unreachable.
 */
export async function fetchOnchainArticle(slug: string): Promise<BlogArticle | null> {
    if (!BLOG_SLUG.test(slug)) return null
    try {
        const raw = await queryEval(GNO_RPC_URL, BLOG_REALM_PATH, `GetPostJSON("${slug}")`, true)
        if (!raw) return null
        const parsed = parseQevalJSON(raw)
        if (!isMeta(parsed) || parsed.slug !== slug) return null
        const bodyField = (parsed as unknown as Record<string, unknown>).body
        const body = typeof bodyField === "string" ? bodyField : ""
        if (!body) return null
        return toArticle(parsed, body)
    } catch {
        return null
    }
}

/**
 * Fetch published on-chain articles in bounded pages, then fetch bodies with
 * limited concurrency. Any uncertain or incomplete result falls back to the
 * static set; the UI must not present a partial on-chain list as complete.
 */
export async function fetchOnchainArticles(): Promise<BlogArticle[] | null> {
    try {
        const metas: OnchainPostMeta[] = []
        const seen = new Set<string>()
        for (let offset = 0; offset < MAX_POSTS; offset += PAGE_SIZE) {
            const raw = await queryEval(GNO_RPC_URL, BLOG_REALM_PATH, `GetPostsPage(${offset}, ${PAGE_SIZE})`, true)
            if (!raw) return null
            const page = parseQevalJSON(raw)
            if (!Array.isArray(page) || page.length > PAGE_SIZE || !page.every(isMeta)) return null
            for (const meta of page) {
                if (seen.has(meta.slug)) return null
                seen.add(meta.slug)
                metas.push(meta)
            }
            if (page.length < PAGE_SIZE) break
            // A full final page could have more unseen posts; fail closed.
            if (metas.length === MAX_POSTS) return null
        }

        const articles: (BlogArticle | null)[] = new Array(metas.length).fill(null)
        let next = 0
        await Promise.all(Array.from({ length: Math.min(BODY_CONCURRENCY, metas.length) }, async () => {
            while (next < metas.length) {
                const index = next++
                articles[index] = await fetchOnchainArticle(metas[index].slug)
            }
        }))
        return articles.every((article): article is BlogArticle => article !== null) ? articles : null
    } catch {
        return null
    }
}
