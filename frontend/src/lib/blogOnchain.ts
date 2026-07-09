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

// The active blog realm. Env-overridable (same pattern as the App Store realm)
// so a future realm version needs no code change.
export const BLOG_REALM_PATH =
    import.meta.env.VITE_BLOG_REALM_PATH || "gno.land/r/samcrew/memba_blog_v1"

/** The realm's exact slug shape (lowercase kebab-case) — the only thing we'll
 * interpolate into a qeval expression. */
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

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
    return typeof m.slug === "string" && SLUG_RE.test(m.slug) &&
        typeof m.title === "string" && typeof m.date === "string"
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
    if (!SLUG_RE.test(slug)) return null
    try {
        const raw = await queryEval(GNO_RPC_URL, BLOG_REALM_PATH, `GetPostJSON("${slug}")`)
        if (!raw) return null
        const parsed = parseQevalJSON(raw)
        if (!isMeta(parsed)) return null
        const bodyField = (parsed as unknown as Record<string, unknown>).body
        const body = typeof bodyField === "string" ? bodyField : ""
        if (!body) return null
        return toArticle(parsed, body)
    } catch {
        return null
    }
}

/**
 * Fetch all published on-chain articles (metas page + bodies in parallel).
 * Returns null when the realm is unreachable (caller falls back to static);
 * [] when the realm is live but empty.
 */
export async function fetchOnchainArticles(): Promise<BlogArticle[] | null> {
    try {
        const raw = await queryEval(GNO_RPC_URL, BLOG_REALM_PATH, "GetPostsPage(0, 50)")
        if (!raw) return null
        const parsed = parseQevalJSON(raw)
        if (!Array.isArray(parsed)) return null
        const metas = parsed.filter(isMeta)
        const articles = await Promise.all(metas.map(m => fetchOnchainArticle(m.slug)))
        return articles.filter((a): a is BlogArticle => a !== null)
    } catch {
        return null
    }
}
