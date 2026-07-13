/**
 * Absolute, shareable permalink for a feed post.
 *
 * Feed routes are network-scoped (`/:network/feed/post/:id`), so a copyable
 * link must carry the same `/:network` prefix as the page the user is on. We
 * derive it from the current path rather than a router hook so any card can
 * build the link without a Router context (PostCard renders in list, thread,
 * and profile — and in tests without a router).
 *
 * @module lib/feedPermalink
 */

/** Build `https://host/:network/feed/post/:id` from the current location. */
export function feedPostPermalink(
    id: bigint,
    loc?: { origin: string; pathname: string },
): string {
    const origin = loc?.origin ?? (typeof window !== "undefined" ? window.location.origin : "")
    const pathname = loc?.pathname ?? (typeof window !== "undefined" ? window.location.pathname : "")
    // First path segment is the network key (/test13/…, /gnoland1/…).
    const net = /^\/([^/]+)(?:\/|$)/.exec(pathname)?.[1] ?? ""
    const prefix = net ? `/${net}` : ""
    return `${origin}${prefix}/feed/post/${id.toString()}`
}
