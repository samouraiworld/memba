/**
 * blogParser — W6.4: PURE front-matter parser for blog articles.
 *
 * No imports, no import.meta — vite.config.ts uses this same module in the
 * node build context to generate the RSS feed (same pattern as lib/sitemap.ts).
 *
 * Article format (frontend/content/blog/YYYY-MM-DD-slug.md):
 *
 *   ---
 *   title: Article title
 *   date: 2026-07-04
 *   description: One-sentence summary (used for meta + RSS + cards).
 *   tags: memba, gno
 *   ---
 *   Markdown body…
 */

export interface BlogArticle {
    slug: string
    title: string
    /** YYYY-MM-DD */
    date: string
    description: string
    tags: string[]
    body: string
}

const FRONT_MATTER_RE = /^---\n([\s\S]*?)\n---\n?/

/** Derive the slug from a file path: "2026-07-04-inside-memba.md" → "inside-memba". */
export function slugFromPath(path: string): string {
    const base = path.split("/").pop() ?? path
    return base.replace(/\.md$/, "").replace(/^\d{4}-\d{2}-\d{2}-/, "")
}

/** Parse one article file; returns null when required front-matter is missing
 *  (fail per-article, never crash the page). */
export function parseBlogArticle(path: string, raw: string): BlogArticle | null {
    const m = raw.match(FRONT_MATTER_RE)
    if (!m) return null

    const fields: Record<string, string> = {}
    for (const line of m[1].split("\n")) {
        const idx = line.indexOf(":")
        if (idx === -1) continue
        fields[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim()
    }

    const { title, date, description } = fields
    if (!title || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null

    return {
        slug: slugFromPath(path),
        title,
        date,
        description: description ?? "",
        tags: (fields.tags ?? "").split(",").map(t => t.trim()).filter(Boolean),
        body: raw.slice(m[0].length).trim(),
    }
}

/** Parse + sort a {path: raw} map, newest first. Invalid articles are dropped. */
export function parseBlogArticles(files: Record<string, string>): BlogArticle[] {
    return Object.entries(files)
        .map(([p, raw]) => parseBlogArticle(p, raw))
        .filter((a): a is BlogArticle => a !== null)
        .sort((a, b) => b.date.localeCompare(a.date) || a.slug.localeCompare(b.slug))
}

/** RSS 2.0 feed (used by the vite build plugin). */
export function buildRssXml(
    origin: string,
    network: string,
    articles: readonly BlogArticle[],
): string {
    const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    const items = articles.map(a => [
        "    <item>",
        `      <title>${esc(a.title)}</title>`,
        `      <link>${origin}/${network}/blog/${esc(a.slug)}</link>`,
        `      <guid isPermaLink="true">${origin}/${network}/blog/${esc(a.slug)}</guid>`,
        `      <pubDate>${new Date(`${a.date}T00:00:00Z`).toUTCString()}</pubDate>`,
        `      <description>${esc(a.description)}</description>`,
        "    </item>",
    ].join("\n"))
    return [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<rss version="2.0">',
        "  <channel>",
        "    <title>Memba Blog</title>",
        `    <link>${origin}/${network}/blog</link>`,
        "    <description>Memba and gno.land ecosystem updates from the Samourai Coop.</description>",
        ...items,
        "  </channel>",
        "</rss>",
        "",
    ].join("\n")
}
