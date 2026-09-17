import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// The test setup stubs the identity check for every other suite; exercise the real one here.
vi.unmock("./chainIdentity")
vi.mock("../config", async (orig) => ({
    ...(await orig<typeof import("../config")>()),
    GNO_CHAIN_ID: "gnoland-1",
    GNO_RPC_URL: "https://rpc.one",
    GNO_FALLBACK_RPC_URLS: ["https://rpc.two"],
}))
vi.mock("../rpcFallback", async (orig) => ({
    ...(await orig<typeof import("../rpcFallback")>()),
    directRpcCall: vi.fn(),
    resilientAbciQuery: vi.fn(async () => "# DAO"),
}))

import { clearExcludedRpcEndpoints, directRpcCall, getRpcUrlsInOrder } from "../rpcFallback"
import { assertActiveRpcChain, assertRpcChain, clearRpcChainChecks, RpcChainMismatchError, UNREACHABLE_RETRY_MS } from "./chainIdentity"
import { queryRender } from "./shared"

const status = vi.mocked(directRpcCall)
type Answer = string | Error | "hang"
const answering = (byUrl: Record<string, Answer>) => status.mockImplementation((url: string) => {
    const v = byUrl[url]
    if (v === "hang") return new Promise<never>(() => {})
    if (v instanceof Error) return Promise.reject(v)
    return Promise.resolve({ node_info: { network: v } })
})
const callsTo = (url: string) => status.mock.calls.filter(([u]) => u === url).length

/** Settle a promise under fake timers without advancing time. */
async function settledWithoutTime<T>(p: Promise<T>): Promise<{ done: boolean; value?: T; error?: unknown }> {
    let state: { done: boolean; value?: T; error?: unknown } = { done: false }
    p.then((value) => { state = { done: true, value } }, (error) => { state = { done: true, error } })
    for (let i = 0; i < 20; i++) await Promise.resolve()
    return state
}

describe("RPC chain identity", () => {
    beforeEach(() => {
        clearRpcChainChecks()
        clearExcludedRpcEndpoints()
        status.mockReset()
    })
    afterEach(() => vi.useRealTimers())

    it("throws when an RPC answers for another chain", async () => {
        answering({ "https://rpc.one": "pearl-1" })
        await expect(assertRpcChain("https://rpc.one", "gnoland-1")).rejects.toThrow(RpcChainMismatchError)
        await expect(assertRpcChain("https://rpc.one", "gnoland-1")).rejects.toThrow("This RPC serves pearl-1, not gnoland-1")
    })

    it("checks each RPC once per session", async () => {
        answering({ "https://rpc.one": "gnoland-1" })
        await assertRpcChain("https://rpc.one", "gnoland-1")
        await assertRpcChain("https://rpc.one", "gnoland-1")
        expect(callsTo("https://rpc.one")).toBe(1)
    })

    it("remembers a chain mismatch without probing the endpoint again", async () => {
        answering({ "https://rpc.one": "pearl-1" })
        await expect(assertRpcChain("https://rpc.one", "gnoland-1")).rejects.toThrow(RpcChainMismatchError)
        answering({ "https://rpc.one": "gnoland-1" })
        await expect(assertRpcChain("https://rpc.one", "gnoland-1")).rejects.toThrow(RpcChainMismatchError)
        expect(callsTo("https://rpc.one")).toBe(1)
    })

    it("remembers an unreachable endpoint briefly, then probes it again", async () => {
        vi.useFakeTimers()
        answering({ "https://rpc.one": new Error("HTTP 502") })
        await expect(assertRpcChain("https://rpc.one", "gnoland-1")).rejects.toThrow("HTTP 502")
        answering({ "https://rpc.one": "gnoland-1" })
        await expect(assertRpcChain("https://rpc.one", "gnoland-1")).rejects.toThrow()
        expect(callsTo("https://rpc.one")).toBe(1)
        vi.advanceTimersByTime(UNREACHABLE_RETRY_MS + 1)
        await expect(assertRpcChain("https://rpc.one", "gnoland-1")).resolves.toBeUndefined()
        expect(callsTo("https://rpc.one")).toBe(2)
    })

    it("does not wait for a hanging fallback once the primary is verified", async () => {
        vi.useFakeTimers()
        answering({ "https://rpc.one": "gnoland-1", "https://rpc.two": "hang" })
        expect((await settledWithoutTime(queryRender("https://rpc.one", "gno.land/r/gov/dao", "", true))).done).toBe(true)
        // A second strict read neither waits nor probes the hanging fallback again.
        const second = await settledWithoutTime(queryRender("https://rpc.one", "gno.land/r/gov/dao", "", true))
        expect(second).toEqual({ done: true, value: "# DAO" })
        expect(callsTo("https://rpc.two")).toBe(1)
    })

    it("keeps reads working and excludes a fallback that serves another chain", async () => {
        answering({ "https://rpc.one": "gnoland-1", "https://rpc.two": "pearl-1" })
        await expect(queryRender("https://rpc.one", "gno.land/r/gov/dao", "", true)).resolves.toBe("# DAO")
        await vi.waitFor(() => expect(getRpcUrlsInOrder()).toEqual(["https://rpc.one"]))
        await expect(assertActiveRpcChain()).resolves.toBeUndefined()
    })

    it("uses a verified fallback when the primary serves another chain", async () => {
        answering({ "https://rpc.one": "pearl-1", "https://rpc.two": "gnoland-1" })
        await expect(assertActiveRpcChain()).resolves.toBeUndefined()
        expect(getRpcUrlsInOrder()).toEqual(["https://rpc.two"])
    })

    it("tolerates an unreachable fallback when another endpoint is verified", async () => {
        answering({ "https://rpc.one": "gnoland-1", "https://rpc.two": new Error("timeout") })
        await expect(assertActiveRpcChain()).resolves.toBeUndefined()
    })

    it("fails closed when no endpoint could be verified", async () => {
        answering({ "https://rpc.one": new Error("down"), "https://rpc.two": new Error("down") })
        await expect(assertActiveRpcChain()).rejects.toThrow(/verify/)
    })

    it("strict DAO reads refuse to run when every endpoint serves another chain", async () => {
        answering({ "https://rpc.one": "pearl-1", "https://rpc.two": "pearl-1" })
        await expect(queryRender("https://rpc.one", "gno.land/r/gov/dao", "", true)).rejects.toThrow("This RPC serves pearl-1, not gnoland-1")
        // Non-strict reads keep their best-effort contract.
        await expect(queryRender("https://rpc.one", "gno.land/r/gov/dao", "", false)).resolves.toBe("# DAO")
    })
})
