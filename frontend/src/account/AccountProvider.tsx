/**
 * Holds the optional account for the whole app. Mounted once in App.tsx and
 * never re-inserted, so loading the sign-in client remounts nothing. The
 * client (keycloak-js) loads only on "Sign in", when a session is remembered
 * on this device, or when the page is the return of a sign-in redirect; if it
 * fails or takes longer than LOAD_TIMEOUT_MS, the account says it is
 * unavailable and everything else keeps working. Sign-in and sign-out leave
 * the page for the Samourai sign-in pages and come back.
 *
 * @module account/AccountProvider
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { KEYCLOAK_SETTINGS, type KeycloakSettings } from "../lib/config"
import { AccountContext, hasAuthCallback, type AccountApi, type AccountStatus, type AccountUser } from "./accountContext"
import type { AccountClient } from "./loadKeycloak"

export const LOAD_TIMEOUT_MS = 10_000
/** Set while a session exists, so a returning member's sign-in client loads at once; a guest never has it. */
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

export function AccountProvider({ children, settings = KEYCLOAK_SETTINGS }: { children: ReactNode; settings?: KeycloakSettings | null }) {
    // Read once, at the first render: a remembered session, or the return of a
    // sign-in redirect, loads at once even if the app rewrites the URL later.
    const [arrival] = useState(() => {
        const callback = hasAuthCallback(window.location.hash) ? window.location.hash : null
        return { callback, startAtOnce: !!settings && (remembered() || callback !== null) }
    })
    const { startAtOnce } = arrival
    const pendingCallback = useRef(arrival.callback)
    // It is "loading" from the first render, so no sign-in prompt flashes before the client answers.
    const [status, setStatus] = useState<AccountStatus>(() => startAtOnce ? "loading" : "off")
    const [user, setUser] = useState<AccountUser | null>(null)
    const client = useRef<AccountClient | null>(null)
    const loading = useRef<Promise<AccountClient | null> | null>(null)

    const start = useCallback((): Promise<AccountClient | null> => {
        if (!settings) return Promise.resolve(null)
        loading.current ??= (async () => {
            setStatus("loading")
            let timer: ReturnType<typeof setTimeout> | undefined
            // Only the first attempt may finish the arrival's sign-in return.
            const callback = pendingCallback.current
            pendingCallback.current = null
            try {
                const { loadKeycloak } = await import("./loadKeycloak")
                if (callback && !window.location.hash) {
                    // The app rewrote the URL (OS shell, root redirect) before
                    // keycloak-js could read the sign-in return: put it back,
                    // unless the app has set a fragment of its own since.
                    history.replaceState(history.state, "", window.location.pathname + window.location.search + callback)
                }
                const c = await Promise.race([
                    loadKeycloak(settings),
                    new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("sign-in did not load in time")), LOAD_TIMEOUT_MS) }),
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
    }, [settings])

    useEffect(() => {
        if (startAtOnce) void start()
    }, [startAtOnce, start])

    const api = useMemo<AccountApi>(() => ({
        available: !!settings,
        status,
        user,
        // The silent check may already have found a session: then there is nothing to redirect for.
        openSignIn: () => { void start().then((c) => { if (!c || c.user) return; remember(true); c.openSignIn() }) },
        getToken: async () => client.current?.getToken() ?? null,
        // Forget the session first: the sign-out redirect leaves the page.
        signOut: async () => { remember(false); await client.current?.signOut() },
    }), [settings, status, user, start])

    return <AccountContext.Provider value={api}>{children}</AccountContext.Provider>
}
