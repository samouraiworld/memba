/**
 * authSession — the stored auth token, and the one place a rejected session is
 * torn down.
 *
 * WHY THIS MODULE EXISTS (F-29). The token lived entirely inside `useAuth`,
 * which clears it on exactly one condition: natural expiry, checked once a
 * minute. Nothing reacted to the server actually REJECTING it. So a token the
 * backend refuses — wrong chain, rotated server key, a signature that no longer
 * recomputes — stayed in localStorage until its expiry, and the app sat there
 * looking signed in while every authenticated call 401'd. Reloading did not
 * help: `loadToken` only re-checks expiry too, so the same dead token was
 * rehydrated every time. The only escape was clearing site data.
 *
 * That is the durable half of F-29. The backend fix stops us MINTING such a
 * token; this stops an already-issued one from stranding the user, which also
 * covers the tokens minted before that fix ships — including every user
 * currently carrying one.
 *
 * It is a separate module rather than part of `useAuth` because the interceptor
 * that detects the rejection lives in `lib/api`, and `useAuth` imports `api` —
 * putting the shared state in either one creates an import cycle.
 *
 * @module lib/authSession
 */

const TOKEN_KEY = "memba_auth_token"

type Listener = (reason: string) => void
const listeners = new Set<Listener>()

/** Remove the stored token. Safe when localStorage is unavailable. */
export function clearStoredToken() {
    try {
        localStorage.removeItem(TOKEN_KEY)
    } catch {
        /* localStorage unavailable (private browsing / disabled) */
    }
}

export { TOKEN_KEY }

/**
 * Tear down the current session and tell every listener why.
 *
 * Called by the transport interceptor when the server rejects the token, and
 * safe to call when no session exists (it simply notifies nobody useful).
 * Deliberately idempotent: several in-flight requests can fail together, and
 * that must not produce several logout cascades.
 */
export function invalidateSession(reason: string) {
    const had = hasStoredToken()
    clearStoredToken()
    if (!had) return
    for (const l of listeners) {
        try {
            l(reason)
        } catch {
            /* a broken listener must not stop the others from healing */
        }
    }
}

/** True when a token is currently persisted. */
export function hasStoredToken(): boolean {
    try {
        return localStorage.getItem(TOKEN_KEY) !== null
    } catch {
        return false
    }
}

/** Subscribe to session invalidation. Returns an unsubscribe function. */
export function onSessionInvalidated(listener: Listener): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
}
