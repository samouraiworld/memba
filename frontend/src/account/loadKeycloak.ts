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
import type { AccountUser } from "./accountContext"

/** The client whose "admin" role shows the gnomonitoring admin panel link. */
export const ADMIN_ROLE_CLIENT = "gnomonitoring-panel"
/** getToken refreshes the access token when it has less than this left. */
export const TOKEN_MIN_VALIDITY_S = 30
/** The same-origin page keycloak-js frames for the silent session check. */
export const SILENT_CHECK_SSO_PATH = "/silent-check-sso.html"

/** The part of the account client Memba uses (same members ClerkClient had). */
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

/** Where sign-in and sign-out come back to: this page, without its fragment. */
function currentPage(): string {
    return window.location.origin + window.location.pathname + window.location.search
}

export async function loadKeycloak(settings: KeycloakSettings): Promise<AccountClient> {
    const kc = new Keycloak(settings)
    await kc.init({
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
    kc.onAuthRefreshError = () => emit(null)

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
                // Also fails on browsers without Promise.withResolvers, which
                // keycloak-js uses here: treated as signed out, never thrown.
                await kc.updateToken(TOKEN_MIN_VALIDITY_S)
                return kc.token ?? null
            } catch {
                return null
            }
        },
        signOut: () => kc.logout({ redirectUri: currentPage() }),
    }
}
