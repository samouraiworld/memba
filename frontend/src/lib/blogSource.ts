/**
 * blogSource — one hook that decides where /blog articles come from.
 *
 * Flag OFF (prod default): the build-time static pipeline, unchanged.
 * Flag ON  (VITE_ENABLE_ONCHAIN_BLOG): read memba_blog_v1, then UNION with the
 * static set — an on-chain article wins its slug (it is the revisable copy),
 * static-only slugs stay visible (nothing disappears mid-migration), and any
 * realm outage falls back to static wholesale. Identity rule mirrors the
 * validator-naming fix: content availability must never depend on one remote
 * endpoint.
 *
 * @module lib/blogSource
 */

import { useQuery } from "@tanstack/react-query"
import { BLOG_ARTICLES } from "./blog"
import { fetchOnchainArticles } from "./blogOnchain"
import { isOnchainBlogEnabled } from "./config"
import type { BlogArticle } from "./blogParser"

/** Union on-chain + static: on-chain wins per slug; sorted newest-first. */
export function mergeArticles(
    onchain: BlogArticle[] | null | undefined,
    staticArticles: readonly BlogArticle[],
): readonly BlogArticle[] {
    if (!onchain || onchain.length === 0) return staticArticles
    const bySlug = new Map<string, BlogArticle>()
    for (const a of staticArticles) bySlug.set(a.slug, a)
    for (const a of onchain) bySlug.set(a.slug, a) // on-chain wins
    return [...bySlug.values()].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
}

export function useBlogArticles(): { articles: readonly BlogArticle[]; loading: boolean } {
    const enabled = isOnchainBlogEnabled()
    const { data, isLoading } = useQuery({
        queryKey: ["onchain-blog-articles"],
        queryFn: fetchOnchainArticles,
        enabled,
        staleTime: 5 * 60_000,
        retry: 1,
    })
    if (!enabled) return { articles: BLOG_ARTICLES, loading: false }
    // While loading (or on failure) the static set renders — never a blank page.
    return { articles: mergeArticles(data, BLOG_ARTICLES), loading: isLoading }
}

export function useBlogArticle(slug: string | undefined): BlogArticle | undefined {
    const { articles } = useBlogArticles()
    return slug ? articles.find(a => a.slug === slug) : undefined
}
