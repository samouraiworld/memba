/**
 * Integration test for the feed-og edge handler. Lives under src/ (NOT next to
 * the function) because Netlify treats every top-level file in
 * netlify/edge-functions/ as an edge function to deploy — a *.test.ts there
 * imports vitest, which the Deno edge bundler can't resolve, failing the deploy.
 *
 * The handler uses only Web APIs (Request/Response/fetch/URL/AbortController),
 * all available under vitest's Node runtime, so the bot/human/404/error routing
 * is verified here even though there is no Netlify Deno harness locally. The card
 * CONTENT is covered by feedOg.test.
 */
import { describe, it, expect, vi, afterEach } from "vitest"
import handler, { config } from "../../netlify/edge-functions/feed-og"

const BOT = "Twitterbot/1.0"
const HUMAN =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"

function req(path: string, ua: string): Request {
    return new Request(`https://memba.samourai.app${path}`, { headers: { "user-agent": ua } })
}

function ctx() {
    const next = vi.fn(async () => new Response("SPA", { status: 200 }))
    return { next }
}

function stubFetch(body: unknown, ok = true, status = 200) {
    return vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(ok ? JSON.stringify(body) : JSON.stringify({ code: "not_found" }), {
            status,
            headers: { "content-type": "application/json" },
        }),
    )
}

afterEach(() => vi.restoreAllMocks())

describe("feed-og handler routing", () => {
    it("declares the permalink path so Netlify only runs it there", () => {
        expect(config.path).toBe("/feed/post/:id")
    })

    it("passes humans straight through to the SPA (never fetches the backend)", async () => {
        const f = stubFetch({})
        const c = ctx()
        const res = await handler(req("/feed/post/1", HUMAN), c)
        expect(c.next).toHaveBeenCalledOnce()
        expect(f).not.toHaveBeenCalled()
        expect(await res.text()).toBe("SPA")
    })

    it("serves a bot an OG card built from the live root", async () => {
        stubFetch({ root: { id: "1", author: "g1747t5m2f08plqjlrjk2q0qld7465hxz8gkx59c", body: "Hello world!" } })
        const c = ctx()
        const res = await handler(req("/feed/post/1", BOT), c)
        expect(c.next).not.toHaveBeenCalled()
        expect(res.status).toBe(200)
        expect(res.headers.get("content-type")).toContain("text/html")
        expect(res.headers.get("vary")?.toLowerCase()).toContain("user-agent")
        const html = await res.text()
        expect(html).toContain(`content="Hello world!"`)
        expect(html).toContain("/feed/post/1")
    })

    it("(P0) never leaks a tombstoned body to a bot", async () => {
        stubFetch({ root: { id: "7", author: "g1x", body: "LEAK-ME", hidden: true } })
        const c = ctx()
        const res = await handler(req("/feed/post/7", BOT), c)
        const html = await res.text()
        expect(html).not.toContain("LEAK-ME")
        expect(html).toContain("no longer available")
    })

    it("falls through to the SPA when the backend 404s (not-found or blocklisted)", async () => {
        stubFetch(null, false, 404)
        const c = ctx()
        await handler(req("/feed/post/99999", BOT), c)
        expect(c.next).toHaveBeenCalledOnce()
    })

    it("falls through to the SPA on a network error (fail-open, no crash)", async () => {
        vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("boom"))
        const c = ctx()
        await handler(req("/feed/post/1", BOT), c)
        expect(c.next).toHaveBeenCalledOnce()
    })

    it("ignores a non-numeric id without touching the backend", async () => {
        const f = stubFetch({})
        const c = ctx()
        await handler(req("/feed/post/not-a-number", BOT), c)
        expect(f).not.toHaveBeenCalled()
        expect(c.next).toHaveBeenCalledOnce()
    })
})
