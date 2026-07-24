import { useCallback, useState } from "react"

const KEY = "memba_feed_mod_bearer"

function readStored(): string {
    try {
        return sessionStorage.getItem(KEY) ?? ""
    } catch {
        return "" // SSR / private mode / storage disabled
    }
}

/**
 * Holds the operator-pasted `FEED_MODERATION_BEARER` for the moderation console
 * (feed v2 C.4) — for THIS TAB only.
 *
 * Security posture (deliberate): the secret is mirrored to **sessionStorage**
 * (tab-scoped, cleared when the tab closes) so it survives an in-tab reload, but
 * **never** to localStorage (which is cross-tab and persistent) and **never** to
 * an env / `import.meta.env` var (which would bake it into the shipped bundle).
 * Callers must also keep it out of URLs, query-key *values*, and logs.
 */
export function useModeratorBearer() {
    const [bearer, setBearerState] = useState<string>(readStored)

    const setBearer = useCallback((v: string) => {
        const next = v.trim()
        setBearerState(next)
        try {
            if (next) sessionStorage.setItem(KEY, next)
            else sessionStorage.removeItem(KEY)
        } catch {
            /* storage disabled — keep it in memory for this session only */
        }
    }, [])

    const clearBearer = useCallback(() => setBearer(""), [setBearer])

    return { bearer, setBearer, clearBearer, hasBearer: bearer.length > 0 }
}
