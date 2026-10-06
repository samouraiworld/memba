import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const reads = vi.hoisted(() => ({
    terms: vi.fn(), status: vi.fn(), reserved: vi.fn(),
    fresh: vi.fn(), covers: vi.fn(), broadcast: vi.fn(), verify: vi.fn(),
}))
vi.mock("../../../lib/tokenLaunchpadSalesClient", async (load) => ({
    ...(await load<typeof import("../../../lib/tokenLaunchpadSalesClient")>()),
    TokenLaunchpadSalesClient: class { terms = reads.terms },
}))
vi.mock("../../../lib/tokenLaunchpadConfigClient", async (load) => ({
    ...(await load<typeof import("../../../lib/tokenLaunchpadConfigClient")>()),
    readActionStatus: reads.status, readReserved: reads.reserved,
}))
vi.mock("../../../lib/grc20", async (load) => ({
    ...(await load<typeof import("../../../lib/grc20")>()),
    freshFeeForGasWanted: reads.fresh, assertFeeStillCovers: reads.covers, doContractBroadcast: reads.broadcast,
}))
vi.mock("../../wallet/sendRequest", () => ({ verifySendTx: reads.verify }))

import { TOKEN_LAUNCHPAD_SALES_PATH, type LaunchTermsView } from "../../../lib/tokenLaunchpadSalesClient"
import { MAX_INT64 } from "./createDirect"
import { createFairRequest, FAIR_BYTES, FAIR_GAS_WANTED, fairLaunchProblem, saleAllocation, SETTLEMENT_DISCLOSURE, type FairLaunch } from "./createFair"

const CREATOR = "g136j0m08pkm2lwwde9dmlx8uee26llent9s5cpf"
// Release 1: no per-sale cap (MaxInt64).
const TERMS: LaunchTermsView = { version: 4n, currency: "ugnot", directCreationFee: 1_000_000n, fairSaleCreationFee: 2_000_000n, fairSaleRaiseCap: MAX_INT64, primaryFeeBps: 200n }
const NOW = 1_700_000_000n
const launch = (patch: Partial<FairLaunch> = {}): FairLaunch => ({
    name: "Rehearsal Sale", ticker: "REHB", decimals: 6, initialSupply: 1_000_000_000_000n, description: "",
    lotSize: 1_000_000_000n, lots: 600n, walletCapLots: 300n, softQuote: 200_000_000n,
    startPrice: 500_000n, floorPrice: 500_000n, decrement: 0n, intervalSeconds: 60n,
    startsIn: 600n, durationSeconds: 86_400n, ...patch,
})

beforeEach(() => {
    for (const fn of Object.values(reads)) fn.mockReset()
    reads.terms.mockResolvedValue(TERMS)
    reads.status.mockResolvedValue({ open: true })
    reads.reserved.mockResolvedValue(false)
    reads.covers.mockResolvedValue(undefined)
    vi.useFakeTimers({ now: Number(NOW) * 1000, toFake: ["Date"] })
})
afterEach(() => vi.useRealTimers())

describe("fair sale rules", () => {
    it("names the part of the wizard each broken rule belongs to", () => {
        expect(fairLaunchProblem(launch())).toBeNull()
        expect(fairLaunchProblem(launch({ startPrice: 500_000n, floorPrice: 100_000n, decrement: 50_000n }))).toBeNull()
        const cases: [Partial<FairLaunch>, string, RegExp][] = [
            [{ name: "" }, "token", /name/], [{ ticker: "GNOT" }, "token", /reserved/], [{ decimals: 13 }, "token", /Decimals/],
            [{ initialSupply: 0n }, "token", /supply/],
            [{ lotSize: 0n }, "sale", /at least one/], [{ lots: 0n }, "sale", /at least one/],
            [{ lots: 1_001n }, "sale", /exceed the supply/],
            [{ walletCapLots: 0n }, "sale", /wallet/], [{ walletCapLots: 601n }, "sale", /wallet/],
            [{ startPrice: 0n, floorPrice: 0n }, "sale", /above zero/], [{ floorPrice: 600_000n }, "sale", /floor/],
            [{ floorPrice: 100_000n }, "sale", /price step/],
            [{ intervalSeconds: 0n }, "sale", /period/],
            [{ startsIn: 599n }, "sale", /ten minutes/], [{ startsIn: 365n * 86_400n + 1n }, "sale", /365 days/],
            [{ durationSeconds: 0n }, "sale", /365/], [{ durationSeconds: 365n * 86_400n + 1n }, "sale", /365/],
            [{ softQuote: 0n }, "sale", /soft cap/], [{ softQuote: 600n * 500_000n + 1n }, "sale", /reachable/],
            [{ lots: 600n, startPrice: MAX_INT64 / 300n, floorPrice: MAX_INT64 / 300n }, "sale", /raise/],
        ]
        for (const [patch, part, message] of cases) {
            const problem = fairLaunchProblem(launch(patch))
            expect(problem?.part, JSON.stringify(patch, (_k, v) => typeof v === "bigint" ? `${v}` : v)).toBe(part)
            expect(problem?.message).toMatch(message)
        }
        expect(fairLaunchProblem(launch({ lots: 600n, durationSeconds: 365n * 86_400n, startsIn: 365n * 86_400n }))).toBeNull()
        // The earliest opening leaves five minutes to sign.
        expect(fairLaunchProblem(launch({ startsIn: 600n }))).toBeNull()
        // As p/fairmath: a step with the floor at the start price is a fixed price.
        expect(fairLaunchProblem(launch({ decrement: 1n }))).toBeNull()
    })

    it("holds a sale to a lower raise cap when the terms name one", () => {
        expect(fairLaunchProblem(launch(), 600n * 500_000n)).toBeNull()
        expect(fairLaunchProblem(launch(), 600n * 500_000n - 1n)?.message).toMatch(/raise/)
    })
})

describe("fair sale creation request", () => {
    const base = { network: "mainnet", creator: CREATOR, terms: TERMS, now: NOW, gasPrice: { gas: 1000, ugnot: 1 }, onSettled: vi.fn() }

    it("sends exactly the creation fee to CreateFairSale with the window counted from now", () => {
        const request = createFairRequest({ ...base, launch: launch({ startPrice: 500_000n, floorPrice: 100_000n, decrement: 50_000n, intervalSeconds: 3_600n }) })
        expect(request.prepare(undefined).msgs).toEqual([{
            type: "vm/MsgCall",
            value: {
                caller: CREATOR, send: "2000000ugnot", pkg_path: TOKEN_LAUNCHPAD_SALES_PATH, func: "CreateFairSale", max_deposit: `${FAIR_BYTES * 2 * 100}ugnot`,
                args: ["Rehearsal Sale", "REHB", "6", "1000000000000", "600000000000", "1000000000", "600", "300", "200000000", "ugnot", "4",
                    "1700000600", "1700087000", "500000", "100000", "50000", "3600", "", "", "", "", ""],
            },
        }])
        const lines = new Map(request.lines(undefined))
        expect(lines.get("Token")).toBe("Rehearsal Sale: 1000000 REHB, fixed; 400000 REHB to you now")
        expect(lines.get("On sale")).toBe("600 lots of 1000 REHB, at most 300 per wallet")
        expect(lines.get("Primary fee")).toBe("2% of what the sale raises, pinned now")
        expect(lines.get("Creation fee")).toBe("2 GNOT")
        expect(request.warns).toContain(SETTLEMENT_DISCLOSURE)
        expect(request.warns[0]).toBe("Sign within 5 minutes: later, the sale would open too soon and the review refuses it.")
        // Above 2^53 the price is shown to the atom.
        const big = createFairRequest({ ...base, launch: launch({ lots: 2n, walletCapLots: 2n, startPrice: 9_007_199_254_740_993n, floorPrice: 9_007_199_254_740_993n, softQuote: 1n }) })
        expect(new Map(big.lines(undefined)).get("Price per lot")).toBe("9,007,199,254.740993 GNOT")
        expect(saleAllocation(launch())).toBe(600_000_000_000n)
    })

    it("refuses terms without fair sales, and a sale the terms' cap does not admit", () => {
        expect(() => createFairRequest({ ...base, terms: { ...TERMS, fairSaleCreationFee: null }, launch: launch() })).toThrow("no terms")
        expect(() => createFairRequest({ ...base, terms: { ...TERMS, primaryFeeBps: null }, launch: launch() })).toThrow("no terms")
        expect(() => createFairRequest({ ...base, terms: { ...TERMS, fairSaleRaiseCap: 1_000n }, launch: launch() })).toThrow("raise")
    })

    it("rechecks the clock, the terms, the lane, the ticker and the fee before Adena opens", async () => {
        const request = createFairRequest({ ...base, launch: launch() })
        await request.recheck!(undefined)
        expect(reads.status.mock.calls.map(call => call[1])).toEqual(["fairsale"])
        expect(reads.covers).toHaveBeenCalled()

        reads.terms.mockResolvedValueOnce({ ...TERMS, version: 5n })
        await expect(request.recheck!(undefined)).rejects.toThrow("terms changed")
        reads.terms.mockResolvedValueOnce({ ...TERMS, fairSaleCreationFee: 3_000_000n })
        await expect(request.recheck!(undefined)).rejects.toThrow("terms changed")
        reads.status.mockResolvedValueOnce({ open: false })
        await expect(request.recheck!(undefined)).rejects.toThrow("not opening new sales")
        reads.reserved.mockResolvedValueOnce(true)
        await expect(request.recheck!(undefined)).rejects.toThrow("reserved")

        // Signing late: the sale would open less than five minutes after the signature.
        vi.setSystemTime(Number(NOW + 600n - 299n) * 1000)
        await expect(request.recheck!(undefined)).rejects.toThrow("too soon")
    })

    it("broadcasts the reviewed message with the measured gas", async () => {
        const request = createFairRequest({ ...base, launch: launch() })
        reads.broadcast.mockResolvedValue({ hash: "ABC" })
        const beforeSign = vi.fn()
        await request.send(undefined, beforeSign)
        expect(reads.broadcast).toHaveBeenCalledWith(request.prepare(undefined).msgs, "Open the REHB sale", expect.objectContaining({ gasWanted: FAIR_GAS_WANTED, beforeSign }))
        reads.verify.mockResolvedValue("confirmed")
        expect(await request.verify!(undefined, "ABC", undefined)).toBe("confirmed")
    })

    it("asks for at least 1.5 times the gas measured with 3,000 entries per tree", () => {
        expect(FAIR_GAS_WANTED).toBeGreaterThanOrEqual((34_000_000 + 25_000_000) * 1.5)
        expect(FAIR_BYTES).toBeGreaterThanOrEqual(20_119)
    })
})
