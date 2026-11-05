import { describe, it, expect, vi, beforeEach } from "vitest"
import Keycloak from "keycloak-js"
import { loadKeycloak, toUser } from "./loadKeycloak"

/** One fake keycloak-js instance, reset before each test. */
const kc = vi.hoisted(() => ({
    init: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    updateToken: vi.fn(),
    clearToken: vi.fn(),
    authenticated: false as boolean,
    token: undefined as string | undefined,
    tokenParsed: undefined as Record<string, unknown> | undefined,
    onAuthSuccess: undefined as (() => void) | undefined,
    onAuthLogout: undefined as (() => void) | undefined,
    onAuthRefreshError: undefined as (() => void) | undefined,
}))
vi.mock("keycloak-js", () => ({ default: vi.fn(function Keycloak() { return kc }) }))

const SETTINGS = { url: "https://auth.kodera.io", realm: "samourai-app", clientId: "memba-web" }
const here = () => window.location.origin + "/mainnet/alerts?tab=1"

beforeEach(() => {
    vi.mocked(Keycloak).mockClear()
    kc.init.mockReset().mockResolvedValue(false)
    kc.login.mockReset().mockResolvedValue(undefined)
    kc.logout.mockReset().mockResolvedValue(undefined)
    kc.updateToken.mockReset()
    // Like keycloak-js: drops the tokens and reports a logout only when a token was held.
    kc.clearToken.mockReset().mockImplementation(() => {
        if (!kc.token) return
        kc.token = undefined; kc.tokenParsed = undefined; kc.authenticated = false; kc.onAuthLogout?.()
    })
    kc.authenticated = false
    kc.token = undefined
    kc.tokenParsed = undefined
    kc.onAuthSuccess = undefined
    kc.onAuthLogout = undefined
    kc.onAuthRefreshError = undefined
    history.replaceState(null, "", "/mainnet/alerts?tab=1#frag")
})

describe("loadKeycloak", () => {
    it("creates the client from the build settings and checks SSO silently, with PKCE and no login iframe", async () => {
        await loadKeycloak(SETTINGS)
        expect(Keycloak).toHaveBeenCalledWith(SETTINGS)
        expect(kc.init).toHaveBeenCalledWith({ onLoad: "check-sso", pkceMethod: "S256", checkLoginIframe: false,
            silentCheckSsoRedirectUri: `${window.location.origin}/silent-check-sso.html`, silentCheckSsoFallback: false })
    })

    it("maps the token to the account user: sub, email and name", () => {
        expect(toUser({ sub: "kc-1", email: "ada@example.org", name: "Ada Lovelace" })).toEqual({ id: "kc-1", email: "ada@example.org", fullName: "Ada Lovelace", isAdmin: false })
        expect(toUser({ sub: "kc-1" })).toEqual({ id: "kc-1", email: null, fullName: null, isAdmin: false })
        expect(toUser(undefined)).toBeNull()
        expect(toUser({ email: "no-sub@example.org" })).toBeNull()
    })

    it("is admin only with the admin role on the gnomonitoring-panel client", () => {
        const u = (extra: object) => toUser({ sub: "kc-1", ...extra })?.isAdmin
        expect(u({ resource_access: { "gnomonitoring-panel": { roles: ["admin"] } } })).toBe(true)
        expect(u({ resource_access: { "gnomonitoring-panel": { roles: ["viewer"] } } })).toBe(false)
        expect(u({ resource_access: { "memba-web": { roles: ["admin"] } } })).toBe(false)
        expect(u({ realm_access: { roles: ["admin"] } })).toBe(false)
        expect(u({})).toBe(false)
    })

    it("returns a token refreshed to 30 s of validity, and null when signed out or when the refresh fails", async () => {
        const c = await loadKeycloak(SETTINGS)
        expect(await c.getToken()).toBeNull(); expect(kc.updateToken).not.toHaveBeenCalled()
        kc.authenticated = true; kc.token = "jwt"; kc.updateToken.mockResolvedValue(false)
        expect(await c.getToken()).toBe("jwt"); expect(kc.updateToken).toHaveBeenCalledWith(30)
        kc.updateToken.mockRejectedValue(new Error("refresh failed"))
        expect(await c.getToken()).toBeNull()
    })

    it("signs in and out by redirect, back to the current page without its fragment", async () => {
        const c = await loadKeycloak(SETTINGS)
        c.openSignIn(); expect(kc.login).toHaveBeenCalledWith({ redirectUri: here() })
        await c.signOut(); expect(kc.logout).toHaveBeenCalledWith({ redirectUri: here() })
    })

    it("tells the provider when the session ends or a refresh fails", async () => {
        const c = await loadKeycloak(SETTINGS); const seen: unknown[] = []
        const off = c.onChange((u) => seen.push(u))
        kc.authenticated = true; kc.tokenParsed = { sub: "kc-1" }; kc.onAuthSuccess?.()
        kc.onAuthRefreshError?.(); kc.onAuthLogout?.()
        expect(seen).toEqual([{ id: "kc-1", email: null, fullName: null, isAdmin: false }, null, null])
        off(); kc.onAuthLogout?.(); expect(seen).toHaveLength(3)
    })

    it("forgets the tokens when a refresh fails without ending the session (offline, 5xx), so Sign in redirects again", async () => {
        const c = await loadKeycloak(SETTINGS); const seen: unknown[] = []
        c.onChange((u) => seen.push(u))
        kc.authenticated = true; kc.token = "jwt"; kc.tokenParsed = { sub: "kc-1" }
        expect(c.user).not.toBeNull()
        kc.onAuthRefreshError?.()
        expect(c.user).toBeNull()
        expect(kc.clearToken).toHaveBeenCalled()
        expect(seen.at(-1)).toBeNull()
    })

    it("can refresh tokens on browsers without Promise.withResolvers, which keycloak-js needs for it", async () => {
        const native = Promise.withResolvers
        Reflect.deleteProperty(Promise, "withResolvers")
        try {
            await loadKeycloak(SETTINGS)
            expect(typeof Promise.withResolvers).toBe("function")
            const { promise, resolve } = Promise.withResolvers<number>()
            resolve(7)
            expect(await promise).toBe(7)
            const failed = Promise.withResolvers<number>()
            failed.reject(new Error("no"))
            await expect(failed.promise).rejects.toThrow("no")
        } finally {
            Object.defineProperty(Promise, "withResolvers", { value: native, writable: true, configurable: true })
        }
    })

    it("finishes a sign-in return at once, without the silent check during which the app could drop it", async () => {
        history.replaceState(null, "", "/os/settings#state=s1&session_state=x&code=c1")
        await loadKeycloak(SETTINGS)
        expect(kc.init).toHaveBeenCalledWith({ pkceMethod: "S256", checkLoginIframe: false })
    })

    it("keeps the polyfill's promises of the class it is called on", async () => {
        const native = Promise.withResolvers
        Reflect.deleteProperty(Promise, "withResolvers")
        try {
            await loadKeycloak(SETTINGS)
            class Tracked<T> extends Promise<T> {}
            expect(Tracked.withResolvers<number>().promise).toBeInstanceOf(Tracked)
        } finally {
            Object.defineProperty(Promise, "withResolvers", { value: native, writable: true, configurable: true })
        }
    })

    it("rejects when init fails, so the provider can say sign-in is unavailable", async () => {
        kc.init.mockRejectedValue(new Error("Timeout when waiting for 3rd party check iframe message."))
        await expect(loadKeycloak(SETTINGS)).rejects.toThrow(/3rd party/)
    })
})
