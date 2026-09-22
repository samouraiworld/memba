import { afterEach, describe, expect, it, vi } from "vitest"
import { fetchNamespaceListing } from "./gnoweb"
const html = (chain: string) => `<meta content="${chain}" name="gnoconnect:chainid"><a href="/r/samcrew/one">one</a><a href="/r/other/two">other</a><a href="/r/samcrew/../x">invalid</a>`
afterEach(() => vi.unstubAllGlobals())
describe("chain-identified namespace listing", () => {
    it("accepts only exact-namespace paths on the requested chain", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(html("gnoland-1"))))
        const result = await fetchNamespaceListing("https://gno.land", "samcrew", "r", "gnoland-1")
        expect(result).toEqual({ status: "ready", items: [{ name: "one", path: "/r/samcrew/one", gnowebUrl: "https://gno.land/r/samcrew/one" }] })
    })
    it.each([html("other-chain"), '<a href="/r/samcrew/one">one</a>'])("rejects mismatched or missing chain evidence", async body => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body)))
        expect(await fetchNamespaceListing("https://gno.land", "samcrew", "r", "gnoland-1")).toEqual({ status: "unavailable", items: [] })
    })
    it("treats an identified 404 as empty, but a server error as unavailable", async () => {
        const fetcher = vi.fn().mockResolvedValueOnce(new Response(html("gnoland-1"), { status: 404 })).mockResolvedValueOnce(new Response(html("gnoland-1"), { status: 503 })).mockRejectedValueOnce(new TypeError("offline"))
        vi.stubGlobal("fetch", fetcher)
        expect((await fetchNamespaceListing("https://gno.land", "samcrew", "r", "gnoland-1")).status).toBe("ready")
        expect((await fetchNamespaceListing("https://gno.land", "samcrew", "r", "gnoland-1")).status).toBe("unavailable")
        expect((await fetchNamespaceListing("https://gno.land", "samcrew", "r", "gnoland-1")).status).toBe("unavailable")
        expect(fetcher).toHaveBeenCalledTimes(3)
    })
})
