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
/** The EVM session's token (os/evm/evmToken.ts): one session per network family, each under its own key. */
const EVM_TOKEN_KEY = "memba_evm_auth_token"

/** Which session a token belongs to: gno.land's, or the EVM network's. */
export type SessionFamily = "gno" | "evm"
const KEYS: Record<SessionFamily, string> = { gno: TOKEN_KEY, evm: EVM_TOKEN_KEY }

type Listener = (reason: string) => void
const listeners: Record<SessionFamily, Set<Listener>> = { gno: new Set(), evm: new Set() }

/** Remove the stored token. Safe when localStorage is unavailable. */
export function clearStoredToken(family: SessionFamily = "gno") {
    try {
        localStorage.removeItem(KEYS[family])
    } catch {
        /* localStorage unavailable (private browsing / disabled) */
    }
}

export { TOKEN_KEY, EVM_TOKEN_KEY }

/**
 * Tear down one family's session and tell its listeners why; the other family's
 * session is untouched.
 *
 * Called by the transport interceptor when the server rejects the token, and
 * safe to call when no session exists (it simply notifies nobody useful).
 * Deliberately idempotent: several in-flight requests can fail together, and
 * that must not produce several logout cascades.
 */
export function invalidateSession(reason: string, family: SessionFamily = "gno") {
    const had = hasStoredToken(family)
    clearStoredToken(family)
    // The EVM session may live in memory only (its storage write failed): its listeners always hear,
    // and dropping an already-dropped session is harmless. The gno.land session keeps its one-shot rule.
    if (!had && family === "gno") return
    for (const l of listeners[family]) {
        try {
            l(reason)
        } catch {
            /* a broken listener must not stop the others from healing */
        }
    }
}

/** True when a token of this family is currently persisted. */
export function hasStoredToken(family: SessionFamily = "gno"): boolean {
    try {
        return localStorage.getItem(KEYS[family]) !== null
    } catch {
        return false
    }
}

/** Subscribe to session invalidation. Returns an unsubscribe function. */
export function onSessionInvalidated(listener: Listener, family: SessionFamily = "gno"): () => void {
    listeners[family].add(listener)
    return () => listeners[family].delete(listener)
}
