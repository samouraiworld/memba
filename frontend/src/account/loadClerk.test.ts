import { afterEach, describe, expect, it, vi } from "vitest"
import { frontendApiHost, loadClerk } from "./loadClerk"

const KEY = `pk_live_${btoa("clerk.memba.club$")}`

/** Answers each Clerk script tag the way the browser would, once it is appended. */
function serveScripts(outcome: (src: string) => "load" | "error", onLoad: (src: string) => void = () => {}) {
    const append = document.head.appendChild.bind(document.head)
    vi.spyOn(document.head, "appendChild").mockImplementation(<T extends Node>(node: T): T => {
        append(node)
        const el = node as unknown as HTMLScriptElement
        queueMicrotask(() => {
            if (outcome(el.src) === "load") { onLoad(el.src); el.onload?.(new Event("load")) } else el.onerror?.(new Event("error"))
        })
        return node
    })
}

afterEach(() => {
    vi.restoreAllMocks()
    document.head.querySelectorAll("script").forEach((s) => s.remove())
    delete window.Clerk
    delete window.__internal_ClerkUICtor
})

describe("loading Clerk", () => {
    it("reads the instance host from the publishable key, and refuses a key that names none", () => {
        expect(frontendApiHost(KEY)).toBe("clerk.memba.club")
        expect(() => frontendApiHost(`pk_live_${btoa("not a host$")}`)).toThrow()
        expect(() => frontendApiHost("")).toThrow()
    })

    it("fetches the client and its UI from that host only, then loads it dark", async () => {
        const load = vi.fn(async () => {})
        serveScripts(() => "load", (src) => {
            if (src.includes("clerk-js")) window.Clerk = { load, user: null, session: null, addListener: () => () => {}, openSignIn: vi.fn(), signOut: vi.fn(async () => {}) }
            else window.__internal_ClerkUICtor = function ClerkUI() {}
        })
        const client = await loadClerk(KEY)
        const scripts = [...document.head.querySelectorAll("script")]
        expect(scripts.map((s) => s.src).sort()).toEqual([
            "https://clerk.memba.club/npm/@clerk/clerk-js@6/dist/clerk.browser.js",
            "https://clerk.memba.club/npm/@clerk/ui@1/dist/ui.browser.js",
        ])
        expect(scripts.find((s) => s.src.includes("clerk-js"))?.getAttribute("data-clerk-publishable-key")).toBe(KEY)
        expect(load).toHaveBeenCalledWith(expect.objectContaining({ ui: { ClerkUI: window.__internal_ClerkUICtor }, appearance: { variables: expect.objectContaining({ colorBackground: "#212126" }) } }))
        expect(client.user).toBeNull()
        expect(await client.getToken()).toBeNull()
    })

    it("fails when a script does not load, or loads without defining Clerk", async () => {
        serveScripts((src) => src.includes("ui@") ? "error" : "load")
        await expect(loadClerk(KEY)).rejects.toThrow(/did not load/)
        vi.restoreAllMocks()
        serveScripts(() => "load")
        await expect(loadClerk(KEY)).rejects.toThrow(/without defining Clerk/)
    })
})
