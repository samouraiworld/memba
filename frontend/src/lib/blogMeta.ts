/**
 * blogMeta — per-article head meta + BlogPosting JSON-LD for /blog/:slug.
 *
 * RouteMetaSync (W6.3) only knows section-level payloads, so every article
 * shared one generic "Blog — Memba" og:title/description — the exact
 * social-preview-fidelity trigger docs/features/SEO.md named for re-evaluation.
 * This module lets the article page overwrite the head with the loaded
 * article's own title/description and a BlogPosting JSON-LD record.
 *
 * Classic routes have RouteMetaSync, but OS windows do not. Snapshot every
 * value we change so closing or backgrounding News cannot leave an article's
 * identity on the desktop. A newer route write wins during cleanup.
 */
import type { BlogArticle } from "./blogParser"

const JSONLD_ID = "memba-blog-posting"
const BASELINE_ID = "memba-blog-head-baseline"

interface StaticHeadBaseline {
    title: string
    metas: Record<string, string | null>
    canonical: string | null
}

function staticBaseline(): StaticHeadBaseline | null {
    const raw = document.getElementById(BASELINE_ID)?.textContent
    if (!raw) return null
    try {
        const value: unknown = JSON.parse(raw)
        if (typeof value !== "object" || value === null) return null
        const data = value as Partial<StaticHeadBaseline>
        if (typeof data.title !== "string" || typeof data.metas !== "object" || data.metas === null) return null
        return data as StaticHeadBaseline
    } catch { return null }
}

interface SavedMeta {
    node: HTMLMetaElement | null
    original: string | null
    written: string
}

interface SavedHead {
    title: string
    writtenTitle: string
    metas: Map<string, SavedMeta>
    canonical: { node: HTMLLinkElement | null; original: string | null; written: string } | null
    baseline: StaticHeadBaseline | null
}

let saved: SavedHead | null = null

function upsertMeta(selector: string, attrs: Record<string, string>, content: string): void {
    let node = document.head.querySelector<HTMLMetaElement>(selector)
    if (saved && !saved.metas.has(selector)) {
        const key = attrs.name ?? attrs.property
        const baselineValue = key && saved.baseline && Object.prototype.hasOwnProperty.call(saved.baseline.metas, key)
            ? saved.baseline!.metas[key] : undefined
        saved.metas.set(selector, { node, original: baselineValue === undefined ? node?.getAttribute("content") ?? null : baselineValue, written: content })
    }
    if (!node) {
        node = document.createElement("meta")
        for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v)
        document.head.appendChild(node)
    }
    node.setAttribute("content", content)
    const record = saved?.metas.get(selector)
    if (record) record.written = content
}

function upsertCanonical(href: string): void {
    let node = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')
    if (saved && !saved.canonical) saved.canonical = { node, original: saved.baseline ? saved.baseline.canonical : node?.getAttribute("href") ?? null, written: href }
    if (!node) {
        node = document.createElement("link")
        node.rel = "canonical"
        document.head.appendChild(node)
    }
    node.href = href
    if (saved?.canonical) saved.canonical.written = href
}

/** Apply the article's own description/OG/twitter meta + BlogPosting JSON-LD. */
export function applyArticleHeadMeta(article: BlogArticle, url: string): void {
    // Share identities describe the route, never tracking parameters or an
    // in-page anchor from the browser's current location.
    const parsedUrl = new URL(url)
    const canonicalUrl = `${parsedUrl.origin}${parsedUrl.pathname.replace(/\/+$/, "") || "/"}`
    const title = `${article.title} — Memba`
    if (!saved) {
        const baseline = staticBaseline()
        saved = { title: baseline?.title ?? document.title, writtenTitle: title, metas: new Map(), canonical: null, baseline }
    }
    document.title = title
    saved.writtenTitle = title
    upsertMeta('meta[name="description"]', { name: "description" }, article.description)
    upsertMeta('meta[property="og:title"]', { property: "og:title" }, title)
    upsertMeta('meta[property="og:description"]', { property: "og:description" }, article.description)
    upsertMeta('meta[property="og:type"]', { property: "og:type" }, "article")
    upsertMeta('meta[property="og:url"]', { property: "og:url" }, canonicalUrl)
    upsertMeta('meta[property="article:published_time"]', { property: "article:published_time" }, article.date)
    upsertMeta('meta[name="twitter:title"]', { name: "twitter:title" }, title)
    upsertMeta('meta[name="twitter:description"]', { name: "twitter:description" }, article.description)
    upsertCanonical(canonicalUrl)

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
        ...(article.updated ? { dateModified: article.updated } : {}),
        keywords: article.tags.join(", "),
        mainEntityOfPage: canonicalUrl,
        author: { "@type": "Organization", name: "Samourai Coop", url: "https://samourai.world" },
        publisher: { "@type": "Organization", name: "Memba" },
    })
}

/** Restore exactly the previous identity, without clobbering a newer route. */
export function clearArticleHeadMeta(): void {
    if (!saved) return
    if (document.title === saved.writtenTitle) document.title = saved.title
    for (const [selector, record] of saved.metas) {
        const current = document.head.querySelector<HTMLMetaElement>(selector)
        if (!current || current.getAttribute("content") !== record.written) continue
        if (!record.node) current.remove()
        else if (record.original === null && saved.baseline) current.remove()
        else if (record.original === null) current.removeAttribute("content")
        else current.setAttribute("content", record.original)
    }
    const canonical = saved.canonical
    if (canonical) {
        const current = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')
        if (current && current.getAttribute("href") === canonical.written) {
            if (!canonical.node) current.remove()
            else if (canonical.original === null && saved.baseline) current.remove()
            else if (canonical.original === null) current.removeAttribute("href")
            else current.setAttribute("href", canonical.original)
        }
    }
    document.getElementById(JSONLD_ID)?.remove()
    saved = null
}
