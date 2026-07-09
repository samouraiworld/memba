/**
 * blogMeta — per-article head meta + BlogPosting JSON-LD for /blog/:slug.
 *
 * RouteMetaSync (W6.3) only knows section-level payloads, so every article
 * shared one generic "Blog — Memba" og:title/description — the exact
 * social-preview-fidelity trigger docs/features/SEO.md named for re-evaluation.
 * This module lets the article page overwrite the head with the loaded
 * article's own title/description and a BlogPosting JSON-LD record.
 *
 * Effect-ordering contract: RouteMetaSync renders BEFORE the router Outlet in
 * Layout, so its passive effect flushes before the article page's — the
 * article's head write always wins on navigation. On unmount the article
 * restores what RouteMetaSync does NOT own (og:type, the JSON-LD script);
 * everything else is overwritten by the next route's payload anyway.
 */
import type { BlogArticle } from "./blogParser"

const JSONLD_ID = "memba-blog-posting"

function upsertMeta(selector: string, attrs: Record<string, string>, content: string): void {
    let node = document.head.querySelector<HTMLMetaElement>(selector)
    if (!node) {
        node = document.createElement("meta")
        for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v)
        document.head.appendChild(node)
    }
    node.setAttribute("content", content)
}

/** Apply the article's own description/OG/twitter meta + BlogPosting JSON-LD. */
export function applyArticleHeadMeta(article: BlogArticle, url: string): void {
    const title = `${article.title} — Memba`
    upsertMeta('meta[name="description"]', { name: "description" }, article.description)
    upsertMeta('meta[property="og:title"]', { property: "og:title" }, title)
    upsertMeta('meta[property="og:description"]', { property: "og:description" }, article.description)
    upsertMeta('meta[property="og:type"]', { property: "og:type" }, "article")
    upsertMeta('meta[name="twitter:title"]', { name: "twitter:title" }, title)
    upsertMeta('meta[name="twitter:description"]', { name: "twitter:description" }, article.description)

    let node = document.getElementById(JSONLD_ID) as HTMLScriptElement | null
    if (!node) {
        node = document.createElement("script")
        node.type = "application/ld+json"
        node.id = JSONLD_ID
        document.head.appendChild(node)
    }
    node.textContent = JSON.stringify({
        "@context": "https://schema.org",
        "@type": "BlogPosting",
        headline: article.title,
        description: article.description,
        datePublished: article.date,
        keywords: article.tags.join(", "),
        mainEntityOfPage: url,
        author: { "@type": "Organization", name: "Samourai Coop", url: "https://samourai.world" },
        publisher: { "@type": "Organization", name: "Memba" },
    })
}

/** Undo what the next route's RouteMetaSync pass will NOT overwrite. */
export function clearArticleHeadMeta(): void {
    upsertMeta('meta[property="og:type"]', { property: "og:type" }, "website")
    document.getElementById(JSONLD_ID)?.remove()
}
