import { beforeEach, describe, expect, it, vi } from "vitest"

const reads = vi.hoisted(() => ({ launch: vi.fn(), buyer: vi.fn(), status: vi.fn(), covers: vi.fn(), broadcast: vi.fn(), balance: vi.fn() }))
vi.mock("../../../lib/tokenLaunchpadSalesClient", async (load) => ({
    ...(await load<typeof import("../../../lib/tokenLaunchpadSalesClient")>()),
    TokenLaunchpadSalesClient: class { launch = reads.launch; fairBuyer = reads.buyer },
}))
vi.mock("../../../lib/tokenLaunchpadClient", async (load) => ({
    ...(await load<typeof import("../../../lib/tokenLaunchpadClient")>()),
    TokenLaunchpadClient: class { balanceOf = reads.balance },
}))
vi.mock("../../../lib/tokenLaunchpadConfigClient", async (load) => ({ ...(await load<typeof import("../../../lib/tokenLaunchpadConfigClient")>()), readActionStatus: reads.status }))
vi.mock("../../../lib/grc20", async (load) => ({
    ...(await load<typeof import("../../../lib/grc20")>()),
    assertFeeStillCovers: reads.covers, doContractBroadcast: reads.broadcast,
}))

import { TOKEN_LAUNCHPAD_SALES_PATH, type FairSaleView, type LaunchView } from "../../../lib/tokenLaunchpadSalesClient"
import { canSettle, priceAt, saleActionRequest, takingOrders, type SaleAction } from "./saleActions"

const ME = "g136j0m08pkm2lwwde9dmlx8uee26llent9s5cpf"
const CREATOR = "g1x7k4628w93a7wzdhqc06atzx0v50rnshweuxu0"
const NOW = 1_000n
const sale: FairSaleView = {
    creator: CREATOR, quoteCurrency: "ugnot", configVersion: 4n, primaryFeeBps: 200n,
    allocation: 600_000_000n, lotSize: 1_000_000n, walletCapLots: 300n, hardCapLots: 600n, softCapQuote: 200_000_000n,
    start: 100n, end: 10_000n, startPrice: 500_000n, floorPrice: 500_000n, decrement: 0n, intervalSeconds: 60n,
    allowlistRoot: "", holdingGates: "", totalLots: 10n, totalDeposits: 5_000_000n, hardClosedAt: 0n,
    cancelled: false, settled: false, succeeded: false, closeAt: 0n, closePrice: 0n, soldTokens: 0n,
    grossQuote: 0n, primaryFeeQuote: 0n, creatorQuote: 0n, proceedsReleased: false, refundQuote: 0n, unsoldTokens: 0n,
}
const launchOf = (fairSale: FairSaleView): LaunchView => ({
    token: { id: "T2", registryKey: "", grc20Id: "", issuer: "", creator: CREATOR, mode: "fairsale", name: "Fair", ticker: "FAIR", decimals: 6,
        initialSupply: 1n, maxSupply: 1n, totalSupply: 1n, configVersion: 4n, currencyKey: "ugnot", description: "", image: "", website: "",
        xHandle: "", telegram: "", metadataFrozen: false, mintAuthority: "", pendingMintAuthority: "", mintRenounced: false },
    tokenLiability: 0n, vestingCount: 0, fairSale, airdrop: null,
})
const request = (action: SaleAction, fairSale = sale) => saleActionRequest({
    network: "mainnet", caller: ME, launch: launchOf(fairSale), action, now: NOW, gasPrice: { gas: 1000, ugnot: 1 }, onSettled: vi.fn(),
})
const msg = (r: ReturnType<typeof request>) => r.prepare(undefined).msgs[0].value as { func: string; args: string[]; send: string; pkg_path: string; caller: string }

beforeEach(() => {
    for (const fn of Object.values(reads)) fn.mockReset()
    reads.launch.mockResolvedValue(launchOf({ ...sale, start: 0n, end: 99_999_999_999n }))
    reads.status.mockResolvedValue({ open: true })
    reads.buyer.mockResolvedValue({ lots: 0n })
    reads.balance.mockResolvedValue(1_000n)
})

describe("fair-sale prices", () => {
    it("prices a lot as the schedule does: steps down per interval, never below the floor", () => {
        const falling = { ...sale, startPrice: 10n, floorPrice: 5n, decrement: 2n, intervalSeconds: 60n, start: 100n }
        expect([100n, 159n, 160n, 220n, 279n, 280n, 9_000n].map(at => priceAt(falling, at))).toEqual([10n, 10n, 8n, 6n, 6n, 5n, 5n])
        expect(priceAt(sale, 5_000n)).toBe(500_000n)
    })

    it("takes orders only inside the window of an open, unsettled, uncapped sale", () => {
        expect(takingOrders(sale, NOW)).toBe(true)
        for (const [patch, at] of [[{}, 99n], [{}, 10_000n], [{ hardClosedAt: 500n }, NOW], [{ settled: true }, NOW], [{ cancelled: true }, NOW]] as const) {
            expect(takingOrders({ ...sale, ...patch }, at)).toBe(false)
        }
    })
})

describe("fair-sale requests", () => {
    it("orders by attaching the bound at the current price, and says the rest comes back at once", () => {
        const r = request({ kind: "order", lots: 3n, proof: "", mine: 0n })
        expect(msg(r)).toMatchObject({ func: "ContributeFair", args: ["T2", "3", "1500000"], send: "1500000ugnot", pkg_path: TOKEN_LAUNCHPAD_SALES_PATH, caller: ME })
        expect(new Map(r.lines(undefined)).get("You pay at most")).toBe("1.5 GNOT")
        expect(r.note).toMatch(/pays the rest back in the same transaction/)
        const hash = "a".repeat(64)
        expect(msg(request({ kind: "order", lots: 1n, proof: `${hash},${hash}`, mine: 0n }, { ...sale, allowlistRoot: hash }))).toMatchObject({ func: "ContributeFairWithProof", args: ["T2", "1", "500000", `${hash},${hash}`] })
        // A one-address allowlist: its root is the leaf and the proof is empty.
        expect(msg(request({ kind: "order", lots: 1n, proof: "", mine: 0n }, { ...sale, allowlistRoot: hash }))).toMatchObject({ func: "ContributeFairWithProof", args: ["T2", "1", "500000", ""] })
        expect(() => request({ kind: "order", lots: 1n, proof: "AA", mine: 0n }, { ...sale, allowlistRoot: hash })).toThrow("lowercase hashes")
        expect(() => request({ kind: "order", lots: 1n, proof: hash, mine: 0n })).toThrow("takes no allowlist proof")
        expect(() => request({ kind: "order", lots: 2n, proof: "", mine: 299n })).toThrow("at most 300 lots; you have 299")
        expect(() => request({ kind: "order", lots: 3n, proof: "", mine: 0n }, { ...sale, totalLots: 598n })).toThrow("Only 2 lots remain")
        expect(() => request({ kind: "order", lots: 1n, proof: "", mine: 0n }, { ...sale, quoteCurrency: "gno.land/r/gnoland/wugnot.wugnot" })).toThrow("allowance")
        expect(() => request({ kind: "order", lots: 0n, proof: "", mine: 0n })).toThrow("at least one lot")
        expect(() => request({ kind: "order", lots: 1n, proof: "", mine: 0n }, { ...sale, settled: true })).toThrow("not taking orders")
    })

    it("prices an order a step back, so a device clock ahead of the block never under-attaches", () => {
        const falling = { ...sale, startPrice: 10n, floorPrice: 2n, decrement: 2n, intervalSeconds: 60n, start: 100n }
        // At 1,000 the schedule is at the floor; priced as of 940 too. At 170, one step in: priced as of 110, the start price.
        expect(msg(request({ kind: "order", lots: 3n, proof: "", mine: 0n }, falling))).toMatchObject({ args: ["T2", "3", "6"], send: "6ugnot" })
        const early = saleActionRequest({ network: "mainnet", caller: ME, launch: launchOf(falling), action: { kind: "order", lots: 3n, proof: "", mine: 0n }, now: 170n, gasPrice: { gas: 1000, ugnot: 1 }, onSettled: vi.fn() })
        expect(msg(early)).toMatchObject({ args: ["T2", "3", "30"], send: "30ugnot" })
        const later = saleActionRequest({ network: "mainnet", caller: ME, launch: launchOf(falling), action: { kind: "order", lots: 3n, proof: "", mine: 0n }, now: 230n, gasPrice: { gas: 1000, ugnot: 1 }, onSettled: vi.fn() })
        expect(msg(later)).toMatchObject({ args: ["T2", "3", "24"], send: "24ugnot" })
    })

    it("offers settlement only past the end by the clock margin, or once the hard cap closed the sale", () => {
        expect(canSettle(sale, 10_000n)).toBe(false)
        expect(canSettle(sale, 10_060n)).toBe(true)
        expect(canSettle({ ...sale, hardClosedAt: 500n }, NOW)).toBe(true)
        expect(canSettle({ ...sale, cancelled: true }, 99_999n)).toBe(false)
    })

    it("rechecks an order against the live sale and the fair-sale lane", async () => {
        const r = request({ kind: "order", lots: 3n, proof: "", mine: 0n })
        await r.recheck!(undefined)
        expect(reads.covers).toHaveBeenCalled()
        reads.status.mockResolvedValueOnce({ open: false })
        await expect(r.recheck!(undefined)).rejects.toThrow("paused")
        reads.launch.mockResolvedValueOnce(launchOf({ ...sale, start: 0n, end: 99_999_999_999n, totalLots: 598n }))
        await expect(r.recheck!(undefined)).rejects.toThrow("Only 2 lots remain")
        reads.launch.mockResolvedValueOnce(launchOf({ ...sale, settled: true }))
        await expect(r.recheck!(undefined)).rejects.toThrow("no longer taking orders")
        reads.buyer.mockResolvedValueOnce({ lots: 298n })
        await expect(r.recheck!(undefined)).rejects.toThrow("at most 300 lots")
        reads.launch.mockRejectedValueOnce(new Error("offline"))
        await expect(r.recheck!(undefined)).rejects.toThrow("offline")
        const gated = request({ kind: "order", lots: 1n, proof: "", mine: 0n }, { ...sale, holdingGates: "token:T1:500" })
        expect(new Map(gated.lines(undefined)).get("Holding gate")).toBe("at least 500 base units of T1")
        reads.launch.mockResolvedValueOnce(launchOf({ ...sale, start: 0n, end: 99_999_999_999n, holdingGates: "token:T1:500" }))
        reads.balance.mockResolvedValueOnce(499n)
        await expect(gated.recheck!(undefined)).rejects.toThrow("You hold less T1")
    })

    it("settles, claims for a buyer and releases proceeds with no coins, each rechecked", async () => {
        const settle = request({ kind: "settle" })
        expect(msg(settle)).toMatchObject({ func: "SettleFair", args: ["T2"], send: "" })
        await settle.recheck!(undefined)
        reads.launch.mockResolvedValueOnce(launchOf({ ...sale, settled: true }))
        await expect(settle.recheck!(undefined)).rejects.toThrow("already settled")
        reads.launch.mockResolvedValueOnce(launchOf({ ...sale, cancelled: true }))
        await expect(settle.recheck!(undefined)).rejects.toThrow("was cancelled")
        expect(settle.note).not.toMatch(/sends nothing/)

        const claim = request({ kind: "claim", buyer: ME, claimableTokens: 3_000_000n, claimableRefund: 0n })
        expect(msg(claim)).toMatchObject({ func: "ClaimFair", args: ["T2", ME], send: "" })
        expect(new Map(claim.lines(undefined)).get("It pays")).toBe("3 FAIR and 0 GNOT back")
        reads.buyer.mockResolvedValueOnce({ settled: true, claimed: false, claimableTokens: 3_000_000n, claimableRefund: 0n })
        await claim.recheck!(undefined)
        reads.buyer.mockResolvedValueOnce({ settled: true, claimed: true, claimableTokens: 0n, claimableRefund: 0n })
        await expect(claim.recheck!(undefined)).rejects.toThrow("already made")
        reads.buyer.mockResolvedValueOnce({ settled: true, claimed: false, claimableTokens: 2_000_000n, claimableRefund: 1n })
        await expect(claim.recheck!(undefined)).rejects.toThrow("changed")

        const settled = { ...sale, settled: true, succeeded: true, grossQuote: 5_000_000n, creatorQuote: 4_900_000n, primaryFeeQuote: 100_000n }
        const release = request({ kind: "release" }, settled)
        expect(msg(release)).toMatchObject({ func: "ReleaseFairProceeds", args: ["T2"], send: "" })
        expect(new Map(release.lines(undefined)).get("Pays")).toBe(`4.9 GNOT to the creator, ${CREATOR}`)
        reads.launch.mockResolvedValueOnce(launchOf({ ...settled, proceedsReleased: true }))
        await expect(release.recheck!(undefined)).rejects.toThrow("not waiting")
    })

    it("broadcasts the reviewed message", async () => {
        const r = request({ kind: "settle" })
        reads.broadcast.mockResolvedValue({ hash: "X" })
        const beforeSign = vi.fn()
        await r.send(undefined, beforeSign)
        expect(reads.broadcast).toHaveBeenCalledWith(r.prepare(undefined).msgs, "Settle the sale of FAIR", expect.objectContaining({ gasWanted: 60_000_000, beforeSign }))
    })
})
