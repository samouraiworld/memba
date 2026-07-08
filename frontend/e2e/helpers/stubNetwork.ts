import type { Page } from '@playwright/test'

/**
 * Abort backend/RPC/indexer/3p egress so renders are deterministic for visual
 * diffs, WITHOUT ever aborting a request served by the local dev server.
 *
 * The trap this guards against: the app bundles Sentry and Clerk as local vite
 * deps (`http://localhost:5173/node_modules/.vite/deps/@sentry_react.js`,
 * `@clerk_clerk-react.js`). A bare `/sentry/` or `/clerk/` pattern matches those
 * too, so aborting them makes main.tsx's top-level `import * as Sentry` fail →
 * React never mounts → the whole page renders blank. (Note the remote patterns
 * below are anchored — `/sentry\./`, `/clerk[.-]/` — but that alone is NOT
 * enough: `/clerk[.-]/` still matches the local `@clerk_clerk-react.js` bundle
 * via its `clerk-react` segment. The localhost guard is what actually protects
 * the local bundles.)
 *
 * Order matters:
 *   1. Abort the app's OWN backend ConnectRPC calls first. In dev these are
 *      same-origin (API_BASE_URL="" → vite proxies `/memba.v1.*` to :8080), so
 *      they live on the localhost origin — the guard in step 2 would otherwise
 *      rescue them. We WANT them aborted (deterministic empty data), so they
 *      must be matched before the localhost guard.
 *   2. Never abort anything else on a localhost origin — that's the dev server's
 *      own bundles/assets (incl. the @sentry/@clerk vite deps).
 *   3. Abort remote backend/RPC/indexer/3p hosts.
 *
 * Remote egress the anchored patterns are designed to catch:
 *   - Sentry ingest:  o<org>.ingest[.us].sentry.io   → /sentry\./
 *   - Clerk:          <slug>.clerk.accounts.dev, clerk.<domain>,
 *                     clerk-telemetry.com             → /clerk[.-]/
 */

/** The app's own backend RPC — same-origin in dev, so aborted BEFORE the
 *  localhost guard (never rescued by it). */
const LOCAL_BACKEND = /memba\.v1\./

/** Localhost origins whose requests are the dev server's own bundles/assets and
 *  must never be aborted. */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1', '0.0.0.0'])

/** Remote backend/RPC/indexer/3p hosts to abort. Anchored so they never match
 *  the app's locally-served vite dep bundles. */
const REMOTE = [
    /\.gno\.land/,
    /testnets\.gno\.land/,
    /gnoland\.network/,
    /\.onbloc\.xyz/,
    /gnolove\.world/,
    /monitoring\.gnolove/,
    /api\.github\.com/,
    /lighthouse\.storage/,
    /samourai\.live/,
    /plausible\.io/,
    /sentry\./,   // o*.ingest[.us].sentry.io — NOT the local @sentry_react.js
    /clerk[.-]/,  // <slug>.clerk.accounts.dev / clerk.<domain> / clerk-telemetry.com
]

export async function stubNetwork(page: Page) {
    await page.route('**/*', route => {
        const url = route.request().url()

        // 1. Always abort the app's own backend RPC, even when same-origin.
        if (LOCAL_BACKEND.test(url)) return route.abort()

        // 2. Never abort anything else served from a localhost origin — that's
        //    the dev server's own bundles (incl. @sentry/@clerk vite deps).
        let host = ''
        try { host = new URL(url).hostname } catch { /* non-URL; fall through */ }
        if (LOCAL_HOSTS.has(host)) return route.continue()

        // 3. Abort remote backend/RPC/indexer/3p egress.
        if (REMOTE.some(re => re.test(url))) return route.abort()

        return route.continue()
    })
}
