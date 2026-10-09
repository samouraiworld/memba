import { beforeEach, describe, expect, it, vi } from "vitest"
import { FEE_SOURCES, parseFeeInteger, readGovFees } from "./govFees"
import { assertWeightedChain, qevalText } from "./weighted"
import { readHeldUgnot } from "./weightedTreasury"
vi.mock("./weighted", () => ({ assertWeightedChain: vi.fn(), qevalText: vi.fn() }))
vi.mock("./weightedTreasury", () => ({ readHeldUgnot: vi.fn() }))
const WALLET = "g136j0m08pkm2lwwde9dmlx8uee26llent9s5cpf"
const ctx = { chainId: "gnoland-1", rpcUrl: "https://rpc.invalid" }
const address = `("${WALLET}" .uverse.address)`
function reply(_url: string, _path: string, expr: string): Promise<string> {
    if (expr.includes("Treasury") || expr === "owner.Owner()") return Promise.resolve(address)
    if (expr === "feesCollected") return Promise.resolve("(9007199254740993 int64)")
    if (expr === "fee") return Promise.resolve("(100000 int64)")
    if (expr === "GetRegistrationFee()") return Promise.resolve("(1000000 int64)")
    return Promise.resolve("(200 int)")
}
beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(qevalText).mockImplementation(reply)
    vi.mocked(readHeldUgnot).mockResolvedValue(9_000_000n)
})
describe("mainnet fee transparency", () => {
    it("keeps exact retained fees distinct from shared wallet balances and forwarded revenue", async () => {
        const data = await readGovFees(ctx)
        expect(data.sources).toHaveLength(4)
        expect(data.sources[3].values?.retainedUgnot).toBe(9007199254740993n)
        expect(data.sources.slice(0, 3).map(s => s.values?.retainedUgnot)).toEqual([null, null, null])
        expect(data.wallets).toEqual([{ address: WALLET, balanceUgnot: 9_000_000n }])
        expect(readHeldUgnot).toHaveBeenCalledTimes(1)
        expect(qevalText).toHaveBeenCalledWith(ctx.rpcUrl, FEE_SOURCES[1].path, "GetGovernanceFeeTerms().EffectiveTreasury", undefined)
    })
    it("reads no application data on another network or when the RPC chain check fails", async () => {
        await expect(readGovFees({ ...ctx, chainId: "onyx-1" })).rejects.toThrow("mainnet")
        vi.mocked(assertWeightedChain).mockRejectedValue(new Error("Wrong chain"))
        await expect(readGovFees(ctx)).rejects.toThrow("Wrong chain")
        expect(qevalText).not.toHaveBeenCalled()
        expect(readHeldUgnot).not.toHaveBeenCalled()
    })
    it("marks a failed source as unavailable without losing the other sources", async () => {
        vi.mocked(qevalText).mockImplementation((u, p, e) => p === FEE_SOURCES[3].path ? Promise.reject(new Error("offline")) : reply(u, p, e))
        const data = await readGovFees(ctx)
        expect(data.sources[3].values).toBeNull()
        expect(data.sources[0].values?.rate).toContain("NFT 2%")
    })
    it("does not turn a failed wallet balance into zero", async () => {
        vi.mocked(readHeldUgnot).mockRejectedValue(new Error("offline"))
        expect((await readGovFees(ctx)).wallets[0].balanceUgnot).toBeNull()
    })
    it("shows genuine zero retained fees after withdrawal", async () => {
        vi.mocked(qevalText).mockImplementation((u, p, e) => e === "feesCollected" ? Promise.resolve("(0 int64)") : reply(u, p, e))
        expect((await readGovFees(ctx)).sources[3].values?.retainedUgnot).toBe(0n)
    })
    it("does not query an unset receiving address", async () => {
        vi.mocked(qevalText).mockImplementation((u, p, e) => e.includes("Treasury") ? Promise.resolve("( .uverse.address)") : reply(u, p, e))
        expect((await readGovFees(ctx)).wallets).toEqual([])
        expect(readHeldUgnot).not.toHaveBeenCalled()
    })
    it.each(["(-1 int64)", "(1.2 int64)", "(900 int32)", "(9223372036854775808 int64)", "garbage"])("refuses invalid amounts: %s", raw => {
        expect(() => parseFeeInteger(raw)).toThrow("Invalid fee amount")
    })
})
