import { beforeEach, describe, expect, it, vi } from "vitest"

const reads = vi.hoisted(() => ({ vesting: vi.fn(), claimed: vi.fn(), covers: vi.fn() }))
vi.mock("../../../lib/tokenLaunchpadSalesClient", async (load) => ({
    ...(await load<typeof import("../../../lib/tokenLaunchpadSalesClient")>()),
    TokenLaunchpadSalesClient: class { vesting = reads.vesting; airdropClaimed = reads.claimed },
}))
vi.mock("../../../lib/grc20", async (load) => ({ ...(await load<typeof import("../../../lib/grc20")>()), assertFeeStillCovers: reads.covers }))

import type { LaunchView, VestingView } from "../../../lib/tokenLaunchpadSalesClient"
import { airdropClaimRequest, claimableNow, releasable, vestingClaimRequest } from "./claims"

const A = "g1x7k4628w93a7wzdhqc06atzx0v50rnshweuxu0"
const B = "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5"
const record: VestingView = { index: 1, beneficiary: A, pendingBeneficiary: "", total: 1_000n, claimed: 100n, start: 1_000n, cliff: 100n, duration: 1_000n, revocable: true, revoked: false, revokedVested: 0n }
const launch = { token: { id: "T3", name: "Vest", ticker: "VEST", decimals: 0 } } as unknown as LaunchView
const base = { network: "mainnet", caller: B, launch, gasPrice: { gas: 1000, ugnot: 1 }, onSettled: vi.fn() }
const value = (r: { prepare: (c: undefined) => { msgs: { value: unknown }[] } }) => r.prepare(undefined).msgs[0].value as { func: string; args: string[]; send: string }

beforeEach(() => { for (const fn of Object.values(reads)) fn.mockReset() })

describe("vesting and airdrop claims", () => {
    it("computes what a vesting claim pays as the schedule does", () => {
        expect(releasable(record, 1_099n)).toBe(-100n)
        expect(releasable(record, 1_100n)).toBe(0n)
        expect(releasable(record, 1_333n)).toBe(233n)
        expect(releasable(record, 2_000n)).toBe(900n)
        expect(releasable({ ...record, revoked: true, revokedVested: 400n }, 9_999n)).toBe(300n)
        // 7 over 2 seconds, 1 second in: 3.5 rounds down to 3, as MulDiv does.
        expect(releasable({ ...record, total: 7n, claimed: 0n, start: 0n, cliff: 0n, duration: 2n }, 1n)).toBe(3n)
    })

    it("judges what is claimable a clock margin back, and nothing while a move is pending", () => {
        // The cliff ends at 1,100: one second after it, the margin still sees the cliff.
        expect(claimableNow(record, 1_101n)).toBeLessThanOrEqual(0n)
        expect(claimableNow(record, 1_393n)).toBe(233n)
        expect(claimableNow({ ...record, pendingBeneficiary: B }, 9_999n)).toBe(0n)
    })

    it("claims vested tokens for the beneficiary, refusing nothing-due and a pending move", async () => {
        const r = vestingClaimRequest({ ...base, record, now: 1_560n })
        expect(value(r)).toEqual({ caller: B, send: "", pkg_path: "gno.land/r/samcrew/launchpad/sales/v1", func: "ClaimVested", args: ["T3", "1"], max_deposit: "500000ugnot" })
        expect(new Map(r.lines(undefined)).get("To")).toBe(A)
        expect(new Map(r.lines(undefined)).get("At least")).toBe("400 VEST, and what vests until the network includes the claim")
        const ended = vestingClaimRequest({ ...base, record: { ...record, revoked: true, revokedVested: 400n }, now: 1_560n })
        expect(new Map(ended.lines(undefined)).get("Amount")).toBe("300 VEST")
        reads.vesting.mockResolvedValueOnce(record)
        await r.recheck!(undefined)
        reads.vesting.mockResolvedValueOnce({ ...record, pendingBeneficiary: B })
        await expect(r.recheck!(undefined)).rejects.toThrow("now pending")
        reads.vesting.mockResolvedValueOnce({ ...record, beneficiary: B })
        await expect(r.recheck!(undefined)).rejects.toThrow("beneficiary changed")
        reads.vesting.mockRejectedValueOnce(new Error("offline"))
        await expect(r.recheck!(undefined)).rejects.toThrow("offline")
        expect(() => vestingClaimRequest({ ...base, record, now: 1_050n })).toThrow("Nothing has vested")
        expect(() => vestingClaimRequest({ ...base, record: { ...record, pendingBeneficiary: B }, now: 1_500n })).toThrow("pending")
    })

    it("claims an airdrop leaf with its proof, refusing a leaf already claimed", async () => {
        const r = airdropClaimRequest({ ...base, claim: { index: 2, beneficiary: A, amount: "50", proof: "aa,bb" } })
        expect(value(r)).toMatchObject({ func: "ClaimAirdrop", args: ["T3", "2", A, "50", "aa,bb"], send: "" })
        expect(new Map(r.lines(undefined)).get("Amount")).toBe("50 VEST")
        reads.claimed.mockResolvedValueOnce(false)
        await r.recheck!(undefined)
        reads.claimed.mockResolvedValueOnce(true)
        await expect(r.recheck!(undefined)).rejects.toThrow("already claimed")
    })
})
