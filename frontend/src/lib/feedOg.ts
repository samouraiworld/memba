/**
 * feedOg.ts — pure, framework-free builders for the crawler Open Graph card of a
 * feed permalink (`/feed/post/:id`). Consumed by the Netlify Edge Function
 * `netlify/edge-functions/feed-og.ts` (Deno), which is why this module imports
 * NOTHING (no proto, no browser globals) and deals only in plain strings — it
 * must run unchanged under Deno Deploy. It is unit-tested here and tree-shaken
 * out of the app bundle (no app code imports it at runtime).
 *
 * HARD SAFETY INVARIANT (mirrors `PostCard` L207–216): a flag-auto-hidden post
 * keeps its body in the DB / RPC response as an audit trail, and `GetFeedThread`
 * returns a hidden OR deleted root *with that body*. The card must NEVER surface
 * it. `renderOgPage` is the single chokepoint that enforces this — the tombstone
 * check lives inside it, not in the caller, so an off-platform preview of a
 * moderated/erased post is impossible by construction.
 *
 * @module lib/feedOg
 */

/** The subset of a FeedPost the OG card needs. Field names match the Connect
 *  JSON of `GetFeedThread` (camelCase; hidden/deleted omitted when false). */
export interface OgPost {
    id: string
    author: string
    body: string
    hidden?: boolean
    deleted?: boolean
    replyCount?: number
}

// Case-insensitive tokens that identify the link-unfurl crawlers. Kept as
// lowercase substrings so a version suffix (Twitterbot/1.0) still matches.
const BOT_TOKENS = [
    "facebookexternalhit",
    "facebookcatalog",
    "twitterbot",
    "telegrambot",
    "discordbot",
    "slackbot",
    "whatsapp",
    "linkedinbot",
    "pinterest",
    "redditbot",
    "googlebot",
    "bingbot",
    "applebot",
    "embedly",
    "vkshare",
    "skypeuripreview",
    "flipboard",
    "nuzzel",
    "bitlybot",
    "mastodon",
]

/** True for the social/link-preview crawlers whose requests we intercept. A
 *  missing UA is treated as a human (serve the SPA) — we only ever ADD a card
 *  for a positively-identified bot, never withhold the app from a real user. */
export function isBotUserAgent(ua: string | null | undefined): boolean {
    if (!ua) return false
    const lower = ua.toLowerCase()
    return BOT_TOKENS.some((t) => lower.includes(t))
}

/** A post whose body must be suppressed: hidden (flag auto-hide, body retained)
 *  or deleted/mod-removed. */
export function isTombstone(post: Pick<OgPost, "hidden" | "deleted">): boolean {
    return Boolean(post.hidden) || Boolean(post.deleted)
}

const HTML_ESCAPES: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
}

/** Escape the five characters that could break out of an HTML attribute/body. */
export function escapeHtml(s: string): string {
    return s.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c])
}

/** Trim to `max` characters, appending a single ellipsis when truncated.
 *  Collapses whitespace/newlines first so a multi-line body reads as one line. */
export function truncate(s: string, max: number): string {
    const flat = s.replace(/\s+/g, " ").trim()
    if (flat.length <= max) return flat
    return flat.slice(0, max).trimEnd() + "…"
}

/** g1747t…kx59c — first 6 + last 5 of a gno address; short ones pass through. */
export function shortAddress(addr: string): string {
    if (addr.length <= 13) return addr
    return `${addr.slice(0, 6)}…${addr.slice(-5)}`
}

const SITE_NAME = "Memba"
const TOMBSTONE_TITLE = "Post unavailable · Memba"
const TOMBSTONE_DESC = "This post is no longer available on Memba."

/**
 * Render the minimal HTML document served to a crawler for one post. No scripts
 * (CSP-safe, and bots don't run JS); just the OG/Twitter meta, a canonical link
 * and a plain human fallback link. The tombstone guard is applied HERE.
 */
export function renderOgPage(opts: { root: OgPost; permalink: string; ogImage: string }): string {
    const { root, permalink, ogImage } = opts
    const tomb = isTombstone(root) || root.body.trim() === ""

    const author = shortAddress(root.author)
    const title = tomb ? TOMBSTONE_TITLE : `Post by ${author} · ${SITE_NAME}`
    const description = tomb ? TOMBSTONE_DESC : truncate(root.body, 200)

    const eTitle = escapeHtml(title)
    const eDesc = escapeHtml(description)
    const eUrl = escapeHtml(permalink)
    const eImg = escapeHtml(ogImage)

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${eTitle}</title>
<meta name="description" content="${eDesc}">
<link rel="canonical" href="${eUrl}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="${SITE_NAME}">
<meta property="og:title" content="${eTitle}">
<meta property="og:description" content="${eDesc}">
<meta property="og:url" content="${eUrl}">
<meta property="og:image" content="${eImg}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${eTitle}">
<meta name="twitter:description" content="${eDesc}">
<meta name="twitter:image" content="${eImg}">
</head>
<body>
<p>${eDesc}</p>
<p><a href="${eUrl}">View this post on ${SITE_NAME}</a></p>
</body>
</html>`
}
