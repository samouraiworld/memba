/**
 * Loads the Samourai accounts client (keycloak-js, realm samourai-app) when
 * someone asks to sign in, when a previous session is remembered on this
 * device, or when the page is the return of a sign-in redirect. The module is
 * reached only through a dynamic import from AccountProvider, so keycloak-js
 * stays out of the main chunk and a guest never loads it.
 *
 * The session is checked silently (check-sso) in a hidden iframe on
 * /silent-check-sso.html; sign-in and sign-out are full-page redirects to
 * the Keycloak pages and back to the current page.
 *
 * @module account/loadKeycloak
 */
import Keycloak, { type KeycloakTokenParsed } from "keycloak-js"
import type { KeycloakSettings } from "../lib/config"
import { hasAuthCallback, type AccountUser } from "./accountContext"

/** The client whose "admin" role shows the gnomonitoring admin panel link. */
export const ADMIN_ROLE_CLIENT = "gnomonitoring-panel"
/** getToken refreshes the access token when it has less than this left. */
export const TOKEN_MIN_VALIDITY_S = 30
/** The same-origin page keycloak-js frames for the silent session check. */
export const SILENT_CHECK_SSO_PATH = "/silent-check-sso.html"
/** Written on sign-out so that every other open tab drops its tokens too. */
export const SIGNED_OUT_KEY = "memba_account_signed_out"

/** The part of the account client Memba uses. */
export interface AccountClient {
    user: AccountUser | null
    onChange: (listener: (user: AccountUser | null) => void) => () => void
    openSignIn: () => void
    getToken: () => Promise<string | null>
    signOut: () => Promise<void>
}

/** Maps the token claims to the account user; null without a subject. */
export function toUser(claims: KeycloakTokenParsed | undefined): AccountUser | null {
    if (!claims || typeof claims.sub !== "string" || !claims.sub) return null
    const roles = claims.resource_access?.[ADMIN_ROLE_CLIENT]?.roles
    return {
        id: claims.sub,
        email: typeof claims.email === "string" ? claims.email : null,
        fullName: typeof claims.name === "string" ? claims.name : null,
        isAdmin: Array.isArray(roles) && roles.includes("admin"),
    }
}

/** keycloak-js 26 calls Promise.withResolvers to refresh a token. Browsers
 *  in the build's target lack it (Safari before 17.4, Chrome before 119):
 *  without this, every refresh would fail while the panel still looks signed in. */
function ensurePromiseWithResolvers(): void {
    const promise = Promise as unknown as { withResolvers?: unknown }
    if (typeof promise.withResolvers === "function") return
    Object.defineProperty(Promise, "withResolvers", {
        configurable: true,
        writable: true,
        value: function withResolvers<T>(this: PromiseConstructor) {
            const C: PromiseConstructor = typeof this === "function" ? this : Promise
            let resolve!: (value: T | PromiseLike<T>) => void
            let reject!: (reason?: unknown) => void
            const p = new C<T>((res, rej) => { resolve = res; reject = rej })
            return { promise: p, resolve, reject }
        },
    })
}

/** Where sign-in and sign-out come back to: this page, without its fragment. */
function currentPage(): string {
    return window.location.origin + window.location.pathname + window.location.search
}

export async function loadKeycloak(settings: KeycloakSettings): Promise<AccountClient> {
    ensurePromiseWithResolvers()
    const kc = new Keycloak(settings)
    // The return of a sign-in redirect holds the session itself: finish it at
    // once. The silent check would first wait for a round trip to the sign-in
    // host, during which the app may rewrite the URL and drop the fragment.
    await kc.init(hasAuthCallback(window.location.hash)
        ? { pkceMethod: "S256", checkLoginIframe: false }
        : {
            onLoad: "check-sso",
            pkceMethod: "S256",
            checkLoginIframe: false,
            silentCheckSsoRedirectUri: window.location.origin + SILENT_CHECK_SSO_PATH,
            // No fallback to a full-page redirect when third-party cookies are
            // blocked: the user just looks signed out until they click "Sign in".
            silentCheckSsoFallback: false,
        })

    const listeners = new Set<(user: AccountUser | null) => void>()
    const emit = (user: AccountUser | null) => { for (const listener of listeners) listener(user) }
    const user = () => (kc.authenticated ? toUser(kc.tokenParsed) : null)
    kc.onAuthSuccess = () => emit(user())
    kc.onAuthLogout = () => emit(null)
    // keycloak-js clears the tokens itself only when the refresh answers 400.
    // Offline or 5xx would leave it "authenticated" while the panel says
    // "Sign in", and that click would then do nothing: forget them here too.
    kc.onAuthRefreshError = () => { kc.clearToken(); emit(null) }
    // Each tab has its own client: a sign-out in another tab ends the session
    // there, so drop this tab's tokens too (the storage event fires only in
    // the other tabs).
    window.addEventListener("storage", (event) => {
        if (event.key === SIGNED_OUT_KEY && event.newValue !== null) { kc.clearToken(); emit(null) }
    })

    return {
        get user() { return user() },
        onChange: (listener) => {
            listeners.add(listener)
            return () => { listeners.delete(listener) }
        },
        openSignIn: () => { void kc.login({ redirectUri: currentPage() }) },
        getToken: async () => {
            if (!kc.authenticated) return null
            try {
                // A failed refresh also signs out (onAuthRefreshError): never thrown.
                await kc.updateToken(TOKEN_MIN_VALIDITY_S)
                return kc.token ?? null
            } catch {
                return null
            }
        },
        signOut: () => {
            try {
                localStorage.setItem(SIGNED_OUT_KEY, String(Date.now()))
                localStorage.removeItem(SIGNED_OUT_KEY)
            } catch { /* storage unavailable: other tabs lose the session at their next refresh */ }
            return kc.logout({ redirectUri: currentPage() })
        },
    }
}
