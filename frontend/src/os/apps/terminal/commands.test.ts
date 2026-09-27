import { beforeEach, describe, expect, it, vi } from "vitest"
import { GNO_CHAIN_ID } from "../../../lib/config"
import { assertRpcChain, RpcChainMismatchError } from "../../../lib/dao/chainIdentity"
import { runReadCommand } from "./commands"

const query = vi.fn()
vi.mock("../../../lib/dao/chainIdentity", () => ({
    assertRpcChain: vi.fn(async () => {}),
    RpcChainMismatchError: class RpcChainMismatchError extends Error {
        constructor(served: string, expected: string) { super(`This RPC serves ${served}, not ${expected}`) }
    },
}))
vi.mock("../../../lib/rpcFallback", () => ({ resilientAbciQueryDetailed: (...args: unknown[]) => query(...args) }))

describe("Terminal read commands", () => {
    beforeEach(() => {
        query.mockReset()
        vi.mocked(assertRpcChain).mockReset().mockResolvedValue(undefined)
    })

    it("uses the chain reader for source and never evaluates source as HTML", async () => {
        query.mockResolvedValue({ kind: "ok", text: "<script>not markup</script>" })
        expect(await runReadCommand("file r/gnoland/home home.gno")).toBe("<script>not markup</script>")
        expect(query).toHaveBeenCalledWith("vm/qfile", "gno.land/r/gnoland/home/home.gno", expect.any(Function))
    })

    it("rejects unsupported expressions and paths before they reach RPC", async () => {
        await expect(runReadCommand("eval r/gnoland/home Get()") ).rejects.toThrow(/Unknown command/)
        await expect(runReadCommand("file r/gnoland/home ../private") ).rejects.toThrow(/file name/)
        await expect(runReadCommand("balance g1bad") ).rejects.toThrow(/Usage/)
        expect(query).not.toHaveBeenCalled()
    })

    it("reports an authoritative empty package listing", async () => {
        query.mockResolvedValue({ kind: "empty" })
        expect(await runReadCommand("pkgs r/gnoland")).toBe("No matching deployed paths.")
        expect(query).toHaveBeenCalledWith("vm/qpaths?limit=50", "gno.land/r/gnoland/", expect.any(Function))
    })

    it("routes render, funcs, and balance to their documented queries", async () => {
        query.mockResolvedValue({ kind: "ok", text: "result" })
        expect(await runReadCommand("render r/gnoland/home docs")).toBe("result")
        expect(query).toHaveBeenCalledWith("vm/qrender", "gno.land/r/gnoland/home:docs", expect.any(Function))
        expect(await runReadCommand("funcs r/gnoland/home")).toBe("result")
        expect(query).toHaveBeenCalledWith("vm/qfuncs", "gno.land/r/gnoland/home", expect.any(Function))
        const address = `g1${"q".repeat(38)}`
        expect(await runReadCommand(`balance ${address}`)).toBe("result")
        expect(query).toHaveBeenCalledWith(`bank/balances/${address}`, "", expect.any(Function))
    })

    it("fails closed on a chain mismatch or ABCI error", async () => {
        query.mockImplementationOnce(async (_path: string, _data: string, verify: (url: string) => Promise<void>) => {
            await verify("https://wrong-chain.example")
            return { kind: "ok", text: "unsafe" }
        })
        vi.mocked(assertRpcChain).mockRejectedValueOnce(new RpcChainMismatchError("pearl-1", GNO_CHAIN_ID))
        await expect(runReadCommand("funcs r/gnoland/home")).rejects.toThrow("This RPC serves pearl-1")
        query.mockResolvedValue({ kind: "abci-error", error: new Error("/pkg/sdk/vm/errors.go:88: stack trace") })
        await expect(runReadCommand("funcs r/gnoland/home")).rejects.toThrow("The chain could not read this path.")
        await expect(runReadCommand("render r/gnoland/home")).rejects.toThrow("The chain could not render this realm.")
    })

    it("verifies the endpoint used for a read and distinguishes transport errors", async () => {
        query.mockImplementation(async (_path: string, _data: string, verify: (url: string) => Promise<void>) => {
            await verify("https://rpc.example")
            return { kind: "ok", text: "safe" }
        })
        expect(await runReadCommand("render r/gov/dao")).toBe("safe")
        expect(assertRpcChain).toHaveBeenCalledWith("https://rpc.example", GNO_CHAIN_ID, true)
        query.mockRejectedValueOnce(new Error("Failed to fetch"))
        await expect(runReadCommand("funcs r/gov/dao")).rejects.toThrow("Could not reach the chain.")
    })

    it("marks oversized output as shortened", async () => {
        query.mockResolvedValue({ kind: "ok", text: "x".repeat(40_000) })
        const result = await runReadCommand("file r/gnoland/home")
        expect(result).toHaveLength(32_000 + "\n\n[Output shortened. Open the package in Explorer to read the full result.]".length)
        expect(result).toContain("[Output shortened.")
    })
})
