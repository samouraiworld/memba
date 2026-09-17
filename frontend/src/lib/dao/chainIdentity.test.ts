import { beforeEach, describe, expect, it, vi } from "vitest"

// The test setup stubs the identity check for every other suite; exercise the real one here.
vi.unmock("./chainIdentity")
vi.mock("../rpcFallback", async (orig) => ({
    ...(await orig<typeof import("../rpcFallback")>()),
    directRpcCall: vi.fn(),
    getRpcUrlsInOrder: vi.fn(() => ["https://rpc.one", "https://rpc.two"]),
    resilientAbciQuery: vi.fn(async () => "# DAO"),
}))
vi.mock("../config", async (orig) => ({ ...(await orig<typeof import("../config")>()), GNO_CHAIN_ID: "gnoland-1" }))

import { directRpcCall, getRpcUrlsInOrder } from "../rpcFallback"
import { assertActiveRpcChain, assertRpcChain, clearRpcChainChecks, RpcChainMismatchError } from "./chainIdentity"
import { queryRender } from "./shared"

const status = vi.mocked(directRpcCall)
const answering = (byUrl: Record<string, string | Error>) => status.mockImplementation(async (url: string) => {
    const v = byUrl[url]
    if (v instanceof Error) throw v
    return { node_info: { network: v } }
})

describe("RPC chain identity", () => {
    beforeEach(() => {
        clearRpcChainChecks()
        status.mockReset()
        vi.mocked(getRpcUrlsInOrder).mockReturnValue(["https://rpc.one", "https://rpc.two"])
    })

    it("throws when an RPC answers for another chain", async () => {
        answering({ "https://rpc.one": "pearl-1" })
        await expect(assertRpcChain("https://rpc.one", "gnoland-1")).rejects.toThrow(RpcChainMismatchError)
        await expect(assertRpcChain("https://rpc.one", "gnoland-1")).rejects.toThrow("This RPC serves pearl-1, not gnoland-1")
    })

    it("checks each RPC once per session", async () => {
        answering({ "https://rpc.one": "gnoland-1" })
        await assertRpcChain("https://rpc.one", "gnoland-1")
        await assertRpcChain("https://rpc.one", "gnoland-1")
        expect(status).toHaveBeenCalledTimes(1)
    })

    it("retries after a transport failure instead of remembering it", async () => {
        answering({ "https://rpc.one": new Error("HTTP 502") })
        await expect(assertRpcChain("https://rpc.one", "gnoland-1")).rejects.toThrow("HTTP 502")
        answering({ "https://rpc.one": "gnoland-1" })
        await expect(assertRpcChain("https://rpc.one", "gnoland-1")).resolves.toBeUndefined()
    })

    it("fails closed when any configured endpoint serves another chain", async () => {
        answering({ "https://rpc.one": "gnoland-1", "https://rpc.two": "pearl-1" })
        await expect(assertActiveRpcChain()).rejects.toThrow(RpcChainMismatchError)
    })

    it("tolerates an unreachable fallback when another endpoint is verified", async () => {
        answering({ "https://rpc.one": "gnoland-1", "https://rpc.two": new Error("timeout") })
        await expect(assertActiveRpcChain()).resolves.toBeUndefined()
    })

    it("fails closed when no endpoint could be verified", async () => {
        answering({ "https://rpc.one": new Error("down"), "https://rpc.two": new Error("down") })
        await expect(assertActiveRpcChain()).rejects.toThrow(/verify/)
    })

    it("strict DAO reads refuse to use an RPC serving another chain", async () => {
        answering({ "https://rpc.one": "pearl-1", "https://rpc.two": "pearl-1" })
        await expect(queryRender("https://rpc.one", "gno.land/r/gov/dao", "", true)).rejects.toThrow("This RPC serves pearl-1, not gnoland-1")
        // Non-strict reads keep their best-effort contract.
        await expect(queryRender("https://rpc.one", "gno.land/r/gov/dao", "", false)).resolves.toBe("# DAO")
    })
})
