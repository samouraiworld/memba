import { isWalletRequestPending } from "./walletActivity"

/** Reload at most once per tab session, including failures on later lazy routes.
 * If durable storage is denied we cannot enforce a cross-reload budget: show
 * the manual fallback instead. Never interrupt a pending wallet request. */
export function tryChunkReload(): boolean {
    if (isWalletRequestPending()) return false
    try {
        if (sessionStorage.getItem(CHUNK_RELOAD_KEY)) return false
        sessionStorage.setItem(CHUNK_RELOAD_KEY, "1")
        if (sessionStorage.getItem(CHUNK_RELOAD_KEY) !== "1") return false
    } catch { return false }
    window.location.reload()
    return true
}

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
        // webpack-era phrasings, kept for safety
        msg.includes("Loading chunk") ||
        msg.includes("Loading CSS chunk") ||
        // WebKit (iOS / macOS Safari)
        msg.includes("is not a valid JavaScript MIME type") ||
        msg.includes("Importing a module script failed")
    )
}
