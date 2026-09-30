/**
 * blogView — what an article page shows besides the article's own fields:
 * its reading time and its body as safe HTML. Shared by the classic Blog page
 * and the Memba OS News window, so the render policy has one definition.
 *
 * @module lib/blogView
 */
import type { BlogArticle } from "./blogParser"
import { renderMarkdown } from "./markdownLite"
import { sanitizeMarkdownHtml } from "./sanitizeMarkdownHtml"

/** Rough reading time from the raw markdown body (~200 wpm). */
export function readingTime(body: string): string {
    const words = body.trim().split(/\s+/).filter(Boolean).length
    return `${Math.max(1, Math.round(words / 200))} min read`
}

/**
 * The article body for `dangerouslySetInnerHTML`: markdownLite (escaped
 * content, protocol-whitelisted links) then DOMPurify. Only reviewed static
 * posts may load images; an on-chain copy never does.
 */
export function articleBodyHtml(article: BlogArticle): string {
    return sanitizeMarkdownHtml(renderMarkdown(article.body, { images: article.source !== "onchain" }))
}
