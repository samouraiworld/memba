import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { runInNewContext } from "node:vm"
import { describe, expect, it, vi } from "vitest"
import { redactSentryBreadcrumb, redactSentryEvent } from "../sentryPrivacy"

const html = readFileSync(resolve(__dirname, "../../../index.html"), "utf8")
const bootstrap = html.match(/<script id="notes-link-bootstrap">([\s\S]*?)<\/script>/)![1]
const analytics = html.match(/function redactMeetAnalytics[\s\S]*?plausible.init\([^\n]+/ )![0]
const notePath = "/mainnet/os/notes/0123456789abcdef0123456789abcdef"
const key = Buffer.alloc(36, 7).toString("base64url")
function load(path = notePath, hash = `#k=${key}`, brokenHistory = false) {
    const location = { pathname: path, search: "?w=app.wallet", hash }
    const callbacks: Record<string, () => void> = {}
    const window: { __membaNotesLink?: (path: string) => Uint8Array | null; __membaClearNotesLink?: () => void } = {}
    const history = { state: { existing: true }, pushState: vi.fn((_state, _title, url: string) => { location.pathname = url }), replaceState: vi.fn((_state, _title, url) => {
        if (brokenHistory) throw new Error("unavailable")
        expect(url).toBe(`${path}?w=app.wallet`); location.hash = ""
    }) }
    runInNewContext(bootstrap, { location, history, window, Uint8Array, atob, setTimeout: (fn: () => void) => { callbacks.expiry = fn; return 1 }, clearTimeout() {}, addEventListener: (name: string, fn: () => void) => { callbacks[name] = fn } })
    return { location, history, window, callbacks }
}
describe("Notes link bootstrap", () => {
    it("runs before telemetry and removes the fragment before handing off once", () => {
        expect(html.indexOf('id="notes-link-bootstrap"')).toBeLessThan(html.indexOf("window.plausible"))
        const page = load()
        expect(page.location.hash).toBe("")
        expect(page.window.__membaNotesLink?.(notePath)).toEqual(new Uint8Array(36).fill(7))
        expect(page.window.__membaNotesLink?.(notePath)).toBeNull()
        expect(Object.keys(page.window)).toEqual([])
    })
    it("discards a secret on path mismatch, navigation, timeout or pagehide", () => {
        for (const reason of ["mismatch", "navigation", "expiry", "pagehide"]) {
            const page = load()
            if (reason === "navigation") page.location.pathname = "/os"
            else if (reason === "expiry" || reason === "pagehide") page.callbacks[reason]()
            expect(page.window.__membaNotesLink?.(reason === "mismatch" ? "/os" : notePath)).toBeNull()
            expect(page.window.__membaNotesLink?.(notePath)).toBeNull()
        }
    })
    it("does not restore a captured secret after navigating away and back", () => {
        const page = load()
        page.history.pushState(null, "", "/os/wallet")
        page.history.pushState(null, "", notePath)
        expect(page.window.__membaNotesLink?.(notePath)).toBeNull()
        const pop = load(); pop.callbacks.popstate()
        expect(pop.window.__membaNotesLink?.(notePath)).toBeNull()
        const locked = load(); locked.window.__membaClearNotesLink?.()
        expect(locked.window.__membaNotesLink?.(notePath)).toBeNull()
    })
    it("bounds and strips malformed fragments and refuses a failed URL cleanup", () => {
        for (const hash of ["#k=", "#k=" + "a".repeat(10000), "#k=" + "!".repeat(48)]) {
            const page = load(notePath, hash)
            expect(page.location.hash).toBe("")
            expect(page.window.__membaNotesLink?.(notePath)).toBeNull()
        }
        expect(load(notePath, `#k=${key}`, true).window.__membaNotesLink?.(notePath)).toBeNull()
        expect(load("/os/wallet").window.__membaNotesLink).toBeUndefined()
    })
    it("redacts note routes and keys from both analytics and diagnostics", () => {
        let transform: (value: unknown) => unknown = value => value
        runInNewContext(analytics, { plausible: { init: ({ transformRequest }: { transformRequest: typeof transform }) => { transform = transformRequest } } })
        const value = `${notePath}#k=${key}`
        const encoded = `%23k%3D${key}`
        for (const output of [transform({ url: value, extra: encoded }), redactSentryBreadcrumb({ data: { url: value, extra: encoded } }), redactSentryEvent({ request: { url: value }, extra: { encoded } })]) {
            expect(JSON.stringify(output)).not.toContain(key)
            expect(JSON.stringify(output)).not.toContain("0123456789abcdef")
        }
    })
})
