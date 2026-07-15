/**
 * feed-og.ts — Netlify Edge Function (Deno) that serves a real Open Graph card
 * to link-unfurl crawlers hitting a feed permalink (`/feed/post/:id`), so a post
 * shared to X / Telegram / Discord / Slack renders as Memba instead of the
 * generic SPA chrome. Humans are passed straight through to the SPA.
 *
 * DISCOVERY: netlify.toml sets `base = "frontend"`, so Netlify auto-discovers
 * edge functions at `frontend/netlify/edge-functions/` (NOT repo-root). The path
 * is declared in-source via `export const config` below — netlify.toml is left
 * untouched (no CSP / redirect risk).
 *
 * SAFETY: all title/description text is built by `renderOgPage`, which suppresses
 * the body of any hidden/deleted (tombstoned) post. Blocklisted posts already
 * 404 from `GetFeedThread`, and any non-200 / error falls through to the SPA — a
 * moderated or erased post can never leak into an off-platform preview.
 *
 * VERIFY (no local Deno test harness): deploy-preview, then
 *   curl -A 'Twitterbot/1.0' https://<preview>/feed/post/1   → OG meta present
 *   curl -A 'Mozilla/5.0 ...'  https://<preview>/feed/post/1 → normal SPA html
 * See docs/features/FEED_OG_RUNBOOK.md.
 */
import { isBotUserAgent, renderOgPage, type OgPost } from "../../src/lib/feedOg.ts"

// Same prod backend the frontend + netlify.toml CSP already point at.
const BACKEND = "https://memba-backend.fly.dev"
const THREAD_RPC = `${BACKEND}/memba.v1.MultisigService/GetFeedThread`
const FETCH_TIMEOUT_MS = 2000

// Minimal shape of the Netlify edge Context we use (avoids a dep import).
interface EdgeContext {
    next: () => Promise<Response>
}

interface ThreadResponse {
    root?: OgPost
}

export default async function handler(request: Request, context: EdgeContext): Promise<Response> {
    // Only positively-identified crawlers get a card; everyone else gets the SPA.
    if (!isBotUserAgent(request.headers.get("user-agent"))) {
        return context.next()
    }

    const url = new URL(request.url)
    // filter(Boolean) so a trailing slash (/feed/post/123/) still yields "123".
    const id = url.pathname.split("/").filter(Boolean).pop() ?? ""
    if (!/^\d+$/.test(id)) {
        return context.next()
    }

    let data: ThreadResponse
    try {
        const ctrl = new AbortController()
        const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
        let res: Response
        try {
            res = await fetch(THREAD_RPC, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ postId: id, limit: 1 }),
                signal: ctrl.signal,
            })
        } finally {
            clearTimeout(timer)
        }
        // 404 (not found OR blocklisted), 5xx, etc. → let the SPA handle it.
        if (!res.ok) return context.next()
        data = (await res.json()) as ThreadResponse
    } catch {
        // Network error / timeout / bad JSON → fail open to the SPA (no leak).
        return context.next()
    }

    if (!data.root) return context.next()

    const html = renderOgPage({
        root: data.root,
        permalink: `${url.origin}/feed/post/${id}`,
        ogImage: `${url.origin}/og-image.jpg`,
    })

    return new Response(html, {
        status: 200,
        headers: {
            "content-type": "text/html; charset=utf-8",
            // `private` keeps this OUT of shared CDN caches, so a post moderated
            // after a card was built isn't served stale to later crawlers — the
            // takedown takes effect on the next fetch. A short client-side max-age
            // still coalesces a single crawler's rapid re-requests. Vary on UA is
            // belt-and-suspenders so a bot card is never keyed to a human.
            "cache-control": "private, max-age=60",
            vary: "user-agent",
        },
    })
}

export const config = { path: "/feed/post/:id" }
