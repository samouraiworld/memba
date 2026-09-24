import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { GNO_CHAIN_ID } from "./config"
import { clearRpcChainChecks } from "./dao/chainIdentity"
import { clearExcludedRpcEndpoints } from "./rpcFallback"
import { fetchNamespaceListing, NAMESPACE_LISTING_LIMIT } from "./gnoweb"
// src/test/setup.ts stubs the chain-identity check; this suite runs the real one
// so the /status probe is part of what is tested.
vi.unmock("./dao/chainIdentity")

const GNOWEB = "https://gno.land"
const b64 = (text: string) => btoa(text)
const status = (network: string) => Response.json({ jsonrpc: "2.0", id: "", result: { node_info: { network } } })
const abci = (Data: string | null, Error: unknown = null, Log = "") =>
    Response.json({ jsonrpc: "2.0", id: "memba-dao", result: { response: { ResponseBase: { Error, Data, Events: null, Log, Info: "" }, Height: "0" } } })

/** Routes the chain-identity probe (GET /status) and the abci_query POST. */
function stubRpc(answer: () => Response | Promise<Response>, network = GNO_CHAIN_ID) {
    const fetcher = vi.fn(async (url: string | URL, init?: RequestInit) => {
        if (String(url).endsWith("/status")) return status(network)
        if (init?.method === "POST") return answer()
        throw new TypeError(`unexpected request ${String(url)}`)
    })
    vi.stubGlobal("fetch", fetcher)
    return fetcher
}
const abciRequests = (fetcher: ReturnType<typeof stubRpc>) =>
    fetcher.mock.calls.filter(([, init]) => init?.method === "POST").map(([, init]) => JSON.parse(String(init?.body)).params)

beforeEach(() => { clearRpcChainChecks(); clearExcludedRpcEndpoints() })
afterEach(() => vi.unstubAllGlobals())

describe("namespace listing via vm/qpaths", () => {
    it("lists the requested namespace and kind, trimmed and deduplicated", async () => {
        const fetcher = stubRpc(() => abci(b64("gno.land/r/samcrew/home\n  gno.land/r/samcrew/memba_feed_v1 \ngno.land/r/samcrew/home\n\ngno.land/r/samcrew/lab/lze\n")))
        const result = await fetchNamespaceListing(GNOWEB, "samcrew", "r", GNO_CHAIN_ID)
        expect(result).toEqual({
            status: "ready",
            items: [
                { name: "home", path: "/r/samcrew/home", gnowebUrl: "https://gno.land/r/samcrew/home" },
                { name: "memba_feed_v1", path: "/r/samcrew/memba_feed_v1", gnowebUrl: "https://gno.land/r/samcrew/memba_feed_v1" },
                { name: "lab/lze", path: "/r/samcrew/lab/lze", gnowebUrl: "https://gno.land/r/samcrew/lab/lze" },
            ],
        })
        // The data is the path prefix (base64 on the wire), with a trailing slash
        // so "samcrew" does not also match "samcrew2"; the limit is explicit.
        expect(abciRequests(fetcher)).toEqual([{ path: `vm/qpaths?limit=${NAMESPACE_LISTING_LIMIT}`, data: b64("gno.land/r/samcrew/") }])
    })

    it("names a versioned package by its path below the namespace", async () => {
        stubRpc(() => abci(b64("gno.land/p/samcrew/avl\ngno.land/p/samcrew/piechart/v0")))
        const result = await fetchNamespaceListing(GNOWEB, "samcrew", "p", GNO_CHAIN_ID)
        expect(result.items.map(item => [item.name, item.path])).toEqual([["avl", "/p/samcrew/avl"], ["piechart/v0", "/p/samcrew/piechart/v0"]])
    })

    it("drops paths from other namespaces, the other kind and malformed lines", async () => {
        stubRpc(() => abci(b64([
            "gno.land/r/samcrew/one",
            "gno.land/r/other/two",
            "gno.land/r/samcrew2/three",
            "gno.land/p/samcrew/pkg",
            "gno.land/r/samcrew/../x",
            "gno.land/r/samcrew//double",
            "gno.land/r/samcrew/",
            "gno.land/r/samcrew",
            "example.com/r/samcrew/four",
            "<html>not a path</html>",
        ].join("\n"))))
        const result = await fetchNamespaceListing(GNOWEB, "samcrew", "r", GNO_CHAIN_ID)
        expect(result).toEqual({ status: "ready", items: [{ name: "one", path: "/r/samcrew/one", gnowebUrl: "https://gno.land/r/samcrew/one" }] })
    })

    it("treats an empty answer as a ready, empty namespace", async () => {
        // What gnoland-1 answers for a namespace with nothing deployed: Data "".
        stubRpc(() => abci(""))
        expect(await fetchNamespaceListing(GNOWEB, "nobodyhere", "r", GNO_CHAIN_ID)).toEqual({ status: "ready", items: [] })
        stubRpc(() => abci(null))
        expect(await fetchNamespaceListing(GNOWEB, "nobodyhere", "p", GNO_CHAIN_ID)).toEqual({ status: "ready", items: [] })
    })

    it("reports a VM error or an RPC error as unavailable, never as empty", async () => {
        stubRpc(() => abci(null, { "@type": "/abci.StringError", value: "invalid limit argument" }, "invalid limit argument"))
        expect(await fetchNamespaceListing(GNOWEB, "samcrew", "r", GNO_CHAIN_ID)).toEqual({ status: "unavailable", items: [] })
        stubRpc(() => Response.json({ jsonrpc: "2.0", id: "", error: { code: -32603, message: "node is syncing" } }))
        expect(await fetchNamespaceListing(GNOWEB, "samcrew", "r", GNO_CHAIN_ID)).toEqual({ status: "unavailable", items: [] })
    })

    it("reports a malformed reply as unavailable", async () => {
        stubRpc(() => abci("%%% not base64 %%%"))
        expect(await fetchNamespaceListing(GNOWEB, "samcrew", "r", GNO_CHAIN_ID)).toEqual({ status: "unavailable", items: [] })
        stubRpc(() => Response.json({ jsonrpc: "2.0", id: "", result: {} }))
        expect(await fetchNamespaceListing(GNOWEB, "samcrew", "r", GNO_CHAIN_ID)).toEqual({ status: "unavailable", items: [] })
        stubRpc(() => new Response("<html>502</html>", { status: 200 }))
        expect(await fetchNamespaceListing(GNOWEB, "samcrew", "r", GNO_CHAIN_ID)).toEqual({ status: "unavailable", items: [] })
    })

    it("does not trust an RPC that serves another chain", async () => {
        const fetcher = stubRpc(() => abci(b64("gno.land/r/samcrew/one")), "some-other-chain")
        expect(await fetchNamespaceListing(GNOWEB, "samcrew", "r", GNO_CHAIN_ID)).toEqual({ status: "unavailable", items: [] })
        expect(abciRequests(fetcher)).toEqual([])
    })

    it("refuses a chain other than the active one, and a namespace that would widen the prefix", async () => {
        const fetcher = stubRpc(() => abci(b64("gno.land/r/samcrew/one")))
        expect(await fetchNamespaceListing(GNOWEB, "samcrew", "r", `${GNO_CHAIN_ID}-other`)).toEqual({ status: "unavailable", items: [] })
        for (const namespace of ["", "samcrew/sub", "../samcrew", "sam crew"]) {
            expect(await fetchNamespaceListing(GNOWEB, namespace, "r", GNO_CHAIN_ID)).toEqual({ status: "unavailable", items: [] })
        }
        expect(fetcher).not.toHaveBeenCalled()
    })
})
