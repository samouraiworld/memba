/**
 * Holds the optional account for the whole app. Mounted once in App.tsx and
 * never re-inserted, so loading Clerk remounts nothing. Clerk loads only on
 * "Sign in" or when a session is remembered on this device; if it fails or
 * takes longer than LOAD_TIMEOUT_MS, the account says it is unavailable and
 * everything else keeps working. (Clerk draws its own UI outside React's
 * tree, so its failures surface here, as a rejected or late load.)
 *
 * @module account/AccountProvider
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { CLERK_PUBLISHABLE_KEY } from "../lib/config"
import { AccountContext, type AccountApi, type AccountStatus, type AccountUser } from "./accountContext"
import type { ClerkClient } from "./loadClerk"

export const LOAD_TIMEOUT_MS = 10_000
/** Set while a session exists, so a returning member's Clerk loads at once; a guest never has it. */
export const SESSION_MARKER = "memba_account_session"

function remembered(): boolean {
    try { return localStorage.getItem(SESSION_MARKER) === "1" } catch { return false }
}

function remember(on: boolean) {
    try {
        if (on) localStorage.setItem(SESSION_MARKER, "1")
        else localStorage.removeItem(SESSION_MARKER)
    } catch { /* storage unavailable: the next visit loads on demand */ }
}

export function AccountProvider({ children, publishableKey = CLERK_PUBLISHABLE_KEY }: { children: ReactNode; publishableKey?: string }) {
    // A remembered session is "loading" from the first render, so no sign-in prompt flashes before Clerk answers.
    const [status, setStatus] = useState<AccountStatus>(() => publishableKey && remembered() ? "loading" : "off")
    const [user, setUser] = useState<AccountUser | null>(null)
    const client = useRef<ClerkClient | null>(null)
    const loading = useRef<Promise<ClerkClient | null> | null>(null)

    const start = useCallback((): Promise<ClerkClient | null> => {
        if (!publishableKey) return Promise.resolve(null)
        loading.current ??= (async () => {
            setStatus("loading")
            let timer: ReturnType<typeof setTimeout> | undefined
            try {
                const { loadClerk } = await import("./loadClerk")
                const c = await Promise.race([
                    loadClerk(publishableKey),
                    new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Clerk did not load in time")), LOAD_TIMEOUT_MS) }),
                ])
                client.current = c
                setUser(c.user)
                remember(!!c.user)
                c.onChange((u) => { setUser(u); remember(!!u) })
                setStatus("ready")
                return c
            } catch (err) {
                console.warn("[account] sign-in unavailable:", err)
                setStatus("failed")
                loading.current = null // the next "Sign in" tries again
                return null
            } finally {
                clearTimeout(timer)
            }
        })()
        return loading.current
    }, [publishableKey])

    useEffect(() => {
        if (remembered()) void start()
    }, [start])

    const api = useMemo<AccountApi>(() => ({
        available: !!publishableKey,
        status,
        user,
        openSignIn: () => { void start().then((c) => c?.openSignIn()) },
        getToken: async () => client.current?.getToken() ?? null,
        signOut: async () => { await client.current?.signOut(); remember(false) },
    }), [publishableKey, status, user, start])

    return <AccountContext.Provider value={api}>{children}</AccountContext.Provider>
}
