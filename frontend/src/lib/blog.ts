/**
 * blog — W6.4: browser-side article loader.
 *
 * Eager build-time glob over content/blog/*.md (raw), parsed by the pure
 * blogParser. Kept separate from blogParser.ts so vite.config.ts can import
 * the parser without dragging import.meta.glob into the node config context.
 */
import { parseBlogArticles } from "./blogParser"
import type { BlogArticle } from "./blogParser"

const files = import.meta.glob("../../content/blog/*.md", {
    query: "?raw",
    import: "default",
    eager: true,
}) as Record<string, string>

/** All articles, newest first (parsed once at module load). */
export const BLOG_ARTICLES: readonly BlogArticle[] = parseBlogArticles(files)

export function getArticle(slug: string): BlogArticle | undefined {
    return BLOG_ARTICLES.find(a => a.slug === slug)
}

export type { BlogArticle }
