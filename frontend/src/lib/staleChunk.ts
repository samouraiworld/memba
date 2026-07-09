/**
 * Stale-chunk detection + reload budget, shared by the root ErrorBoundary and
 * the vite:preloadError handler in main.tsx.
 *
 * After every deploy, the autoUpdate service worker takes over live tabs and
 * purges the previous build's precached chunks; the page's next lazy route
 * load gets the SPA-fallback index.html for a .js URL and the import fails.
 * Both recovery paths reload ONCE per session (the boundary clears the guard
 * on a successful mount), so a genuinely broken deploy shows the error card
 * instead of reload-looping.
 */

/** SessionStorage key for the one-reload-per-session guard. */
export const CHUNK_RELOAD_KEY = "memba_chunk_reload"

/** Detect if an error is a Vite stale chunk failure (dynamic import 404 after deploy).
 *
 * Every browser phrases this differently, and missing one phrasing means that
 * browser's users get the scary generic card instead of the auto-reload. The
 * owner-reported mobile bug was exactly this gap: WebKit (iOS Safari) says
 * "'text/html' is not a valid JavaScript MIME type" — which the
 * Chrome-oriented patterns missed. */
export function isStaleChunkError(error: Error): boolean {
    const msg = error.message || ""
    return (
        // Chrome / Edge
        msg.includes("dynamically imported module") ||
        msg.includes("Failed to fetch") ||
        // webpack-era phrasings, kept for safety
        msg.includes("Loading chunk") ||
        msg.includes("Loading CSS chunk") ||
        // WebKit (iOS / macOS Safari)
        msg.includes("is not a valid JavaScript MIME type") ||
        msg.includes("Importing a module script failed")
    )
}
