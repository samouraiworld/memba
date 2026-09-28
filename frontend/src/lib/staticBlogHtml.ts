/** Build-time article head for committed posts. The app still renders the body. */
import type { BlogArticle } from "./blogParser"

const escapeAttribute = (value: string): string => value.replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[char]!)

const escapeJsonScript = (value: unknown): string => JSON.stringify(value)
    .replace(/&/g, "\\u0026")
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029")

function metaContent(html: string, attribute: "name" | "property", key: string): string | null {
    const tag = [...html.matchAll(/<meta\b[^>]*>/gi)].map(match => match[0]).find(candidate =>
        new RegExp(`\\b${attribute}\\s*=\\s*["']${key}["']`, "i").test(candidate))
    return tag?.match(/\bcontent\s*=\s*["']([^"']*)["']/i)?.[1] ?? null
}

/** Replace generic build identity with a crawler-visible post identity. */
export function staticBlogArticleHtml(indexHtml: string, article: BlogArticle, canonicalUrl: string): string {
    const url = new URL(canonicalUrl)
    if (!/^https:$/.test(url.protocol)) throw new Error("Article canonical URL must use HTTPS")
    const image = new URL(metaContent(indexHtml, "property", "og:image") ?? "/og-image.jpg", url.origin).href
    const title = `${article.title} — Memba`
    // A direct article load starts with article tags already in the document.
    // The OS has no RouteMetaSync, so preserve the original site head for
    // blogMeta's cleanup when this window closes or goes into the background.
    const baseline = {
        title: indexHtml.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? "Memba",
        metas: Object.fromEntries([
            ["description", "name"], ["og:type", "property"], ["og:title", "property"],
            ["og:description", "property"], ["og:url", "property"],
            ["article:published_time", "property"], ["twitter:title", "name"],
            ["twitter:description", "name"],
        ].map(([key, attribute]) => [key, metaContent(indexHtml, attribute as "name" | "property", key)])),
        canonical: indexHtml.match(/<link\b[^>]*\brel\s*=\s*["']canonical["'][^>]*>/i)?.[0]
            .match(/\bhref\s*=\s*["']([^"']*)["']/i)?.[1] ?? null,
    }
    const drop = new Set(["description", "og:type", "og:title", "og:description", "og:url", "og:image",
        "twitter:title", "twitter:description", "twitter:image", "article:published_time", "memba-static-article"])
    const clean = indexHtml
        .replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeAttribute(title)}</title>`)
        .replace(/<meta\b[^>]*>/gi, tag => {
            const key = tag.match(/\b(?:name|property)\s*=\s*["']([^"']+)["']/i)?.[1]
            return key && drop.has(key) ? "" : tag
        })
        .replace(/<link\b[^>]*>/gi, tag => /\brel\s*=\s*["']canonical["']/i.test(tag) ? "" : tag)
    const post = {
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
    }
    const head = [
        `<script type="application/json" id="memba-blog-head-baseline">${escapeJsonScript(baseline)}</script>`,
        `<meta name="memba-static-article" content="${escapeAttribute(article.slug)}" />`,
        `<meta name="description" content="${escapeAttribute(article.description)}" />`,
        `<link rel="canonical" href="${escapeAttribute(canonicalUrl)}" />`,
        '<meta property="og:type" content="article" />',
        `<meta property="og:title" content="${escapeAttribute(title)}" />`,
        `<meta property="og:description" content="${escapeAttribute(article.description)}" />`,
        `<meta property="og:url" content="${escapeAttribute(canonicalUrl)}" />`,
        `<meta property="og:image" content="${escapeAttribute(image)}" />`,
        `<meta property="article:published_time" content="${escapeAttribute(article.date)}" />`,
        `<meta name="twitter:title" content="${escapeAttribute(title)}" />`,
        `<meta name="twitter:description" content="${escapeAttribute(article.description)}" />`,
        `<meta name="twitter:image" content="${escapeAttribute(image)}" />`,
        `<script type="application/ld+json" id="memba-blog-posting">${escapeJsonScript(post)}</script>`,
    ].join("\n  ")
    if (!clean.includes("</head>")) throw new Error("Build index is missing </head>")
    return clean.replace("</head>", `  ${head}\n</head>`)
}
