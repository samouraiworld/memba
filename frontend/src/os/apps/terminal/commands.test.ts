import { beforeEach, describe, expect, it, vi } from "vitest"
import { assertActiveRpcChain } from "../../../lib/dao/chainIdentity"
import { queryRender } from "../../../lib/dao/shared"
import { runReadCommand } from "./commands"

const query = vi.fn()
vi.mock("../../../lib/dao/chainIdentity", () => ({ assertActiveRpcChain: vi.fn(async () => {}) }))
vi.mock("../../../lib/rpcFallback", () => ({ resilientAbciQueryDetailed: (...args: unknown[]) => query(...args) }))
vi.mock("../../../lib/dao/shared", () => ({
    queryRender: vi.fn(async () => "# Home"),
}))

describe("Terminal read commands", () => {
    beforeEach(() => {
        query.mockReset()
        vi.mocked(assertActiveRpcChain).mockReset().mockResolvedValue(undefined)
        vi.mocked(queryRender).mockClear()
    })

    it("uses the chain reader for source and never evaluates source as HTML", async () => {
        query.mockResolvedValue({ kind: "ok", text: "<script>not markup</script>" })
        expect(await runReadCommand("file r/gnoland/home home.gno")).toBe("<script>not markup</script>")
        expect(query).toHaveBeenCalledWith("vm/qfile", "gno.land/r/gnoland/home/home.gno")
    })

    it("rejects unsupported expressions and paths before they reach RPC", async () => {
        await expect(runReadCommand("eval r/gnoland/home Get()") ).rejects.toThrow(/Unknown command/)
        await expect(runReadCommand("file r/gnoland/home ../private") ).rejects.toThrow(/file name/)
        await expect(runReadCommand("balance g1bad") ).rejects.toThrow(/Usage/)
        expect(query).not.toHaveBeenCalled()
    })

    it("reports an authoritative empty package listing", async () => {
        query.mockResolvedValue({ kind: "empty" })
        expect(await runReadCommand("pkgs r/gnoland")).toMatch(/No data/)
        expect(query).toHaveBeenCalledWith("vm/qpaths?limit=50", "gno.land/r/gnoland/")
    })

    it("routes render, funcs, and balance to their documented queries", async () => {
        query.mockResolvedValue({ kind: "ok", text: "result" })
        expect(await runReadCommand("render r/gnoland/home docs")).toBe("# Home")
        expect(queryRender).toHaveBeenCalledWith("", "gno.land/r/gnoland/home", "docs", true)
        expect(await runReadCommand("funcs r/gnoland/home")).toBe("result")
        expect(query).toHaveBeenCalledWith("vm/qfuncs", "gno.land/r/gnoland/home")
        const address = `g1${"q".repeat(38)}`
        expect(await runReadCommand(`balance ${address}`)).toBe("result")
        expect(query).toHaveBeenCalledWith(`bank/balances/${address}`, "")
    })

    it("fails closed on a chain mismatch or ABCI error", async () => {
        vi.mocked(assertActiveRpcChain).mockRejectedValueOnce(new Error("Wrong chain"))
        await expect(runReadCommand("funcs r/gnoland/home")).rejects.toThrow("Wrong chain")
        expect(query).not.toHaveBeenCalled()
        query.mockResolvedValue({ kind: "abci-error", error: new Error("Package missing") })
        await expect(runReadCommand("funcs r/gnoland/home")).rejects.toThrow("Package missing")
    })

    it("marks oversized output as shortened", async () => {
        query.mockResolvedValue({ kind: "ok", text: "x".repeat(40_000) })
        const result = await runReadCommand("file r/gnoland/home")
        expect(result).toHaveLength(32_000 + "\n\n[Output shortened. Open the package in Explorer to read the full result.]".length)
        expect(result).toContain("[Output shortened.")
    })
})
