/**
 * Gas limit and storage-deposit cap for each call into escrow_v4.
 *
 * gno.land mainnet charges a storage deposit on every call that grows realm
 * state, and a call without `max_deposit` lets the chain lock up to its 100 GNOT
 * default. Only CreateContract grows state by much: it stores the title,
 * description and milestone titles. Every other call changes a few status
 * fields and block heights; ArchiveContract shrinks the realm, and the chain
 * refunds the freed deposit to its signer.
 *
 * Measured on an in-memory gnoland node built from the gnoland-1 runtime pin
 * (e75fef82) against the escrow_v4 production source, with its per-client
 * contract index (STORAGE DELTA and GAS USED as gnokey prints them). "Full"
 * means 4,999 other open contracts; escrow_v4 has no global cap, so the realm
 * can grow past that:
 *
 *   CreateContract  6,714 B / 8.7M (smallest) · 8,874 B / 28.4M and 6,553 B /
 *                   28.6M (smallest, full, new / existing client counter) ·
 *                   32,589 B / 201.8M (200 B title, 5,000 B description, 20
 *                   milestones with 200 B titles) · 255.5M (same sizes, half of
 *                   it characters the realm strips: the most gas)
 *   FundMilestone   ≤ 238 B, 6.7M small / 9.4M full   CompleteMilestone ≤ 3 B,  6.0M / 8.7M
 *   ReleaseFunds    ≤ 16 B, 10.4M / 18.5M              RaiseDispute      ≤ 34 B, 6.2M / 8.9M
 *   CancelContract  ≤ 51 B, 13.1M (20 funded)          ClaimRefund       ≤ 12 B, 8.2M / 16.8M
 *   ClaimDisputeTimeout ≤ 9 B, 10.4M / 18.8M           ExpireUnfunded    33 B,   7.0M
 *   ArchiveContract −6,718 B to −32,801 B, 11.9M (largest) / 26.7M (full)
 *
 * The full set adds up to 18.9M gas to a call (ArchiveContract, 7.8M → 26.7M).
 * Where a case was not measured on the full set, its gas basis is the worst
 * small-set figure plus that growth. `escrowBudget.test.ts` checks every
 * measured point against these models.
 *
 * Deposit caps are twice the storage estimate at 100 ugnot per byte, rounded up
 * to 0.01 GNOT; gas limits carry a 25 % margin, rounded up to 1M. The chain
 * locks only the bytes a call really adds, so the cap is a ceiling, not a
 * price. The largest contract the builders produce caps at 7.91 GNOT, under the
 * 10 GNOT ceiling, so no escrow call ever needs an override.
 */
import { STORAGE_PRICE_UGNOT } from "../dao/v2Budget"

/** The escrow_v4 entrypoints Memba signs for a user. */
export type EscrowFunc =
    | "CreateContract"
    | "FundMilestone"
    | "CompleteMilestone"
    | "ReleaseFunds"
    | "RaiseDispute"
    | "CancelContract"
    | "ClaimRefund"
    | "ClaimDisputeTimeout"
    | "ExpireUnfunded"
    | "ArchiveContract"

export type EscrowStateFunc = Exclude<EscrowFunc, "CreateContract">

/** Gas a call gained when the realm went from a few contracts to 5,000 open ones (largest seen: ArchiveContract). */
export const ESCROW_FULL_SET_GAS_GROWTH = 18_900_000

/** Worst gas measured per call with a few contracts in the realm. */
export const ESCROW_CALL_SMALL_SET_GAS: Record<EscrowStateFunc, number> = {
    FundMilestone: 6_700_000,
    CompleteMilestone: 6_000_000,
    ReleaseFunds: 10_400_000,
    RaiseDispute: 6_200_000,
    CancelContract: 13_100_000,
    ClaimRefund: 8_200_000,
    ClaimDisputeTimeout: 10_400_000,
    ExpireUnfunded: 7_000_000,
    ArchiveContract: 11_900_000,
}

/** Gas measured per call with 5,000 open contracts, where that case was run. */
export const ESCROW_CALL_FULL_SET_GAS: Partial<Record<EscrowStateFunc, number>> = {
    FundMilestone: 9_400_000,
    CompleteMilestone: 8_700_000,
    ReleaseFunds: 18_500_000,
    RaiseDispute: 8_900_000,
    ClaimRefund: 16_800_000,
    ClaimDisputeTimeout: 18_800_000,
    ArchiveContract: 26_700_000,
}

/** The gas each call is sized for: the full-set measurement, or the small-set worst plus the full-set growth, whichever is larger. */
export const ESCROW_CALL_GAS_BASIS: Record<EscrowStateFunc, number> = Object.fromEntries(
    (Object.keys(ESCROW_CALL_SMALL_SET_GAS) as EscrowStateFunc[]).map((f) => [
        f,
        Math.max(ESCROW_CALL_FULL_SET_GAS[f] ?? 0, ESCROW_CALL_SMALL_SET_GAS[f] + ESCROW_FULL_SET_GAS_GROWTH),
    ]),
) as Record<EscrowStateFunc, number>

/**
 * Storage estimate for every call but CreateContract: over four times the
 * largest delta measured (FundMilestone, 238 B with 5,000 open contracts).
 */
export const ESCROW_STATE_CALL_STORAGE_BYTES = 1_000

/** Largest gas limit these models produce (CreateContract at the realm's limits). */
export const ESCROW_MAX_CALL_GAS = 350_000_000

export interface EscrowCallBudget {
    gasWanted: number
    /** Storage deposit cap in ugnot. */
    maxDepositUgnot: number
}

export interface CreateContractSizes {
    titleBytes: number
    descriptionBytes: number
    /** The encoded `title:amount,…` argument, exactly as sent. */
    milestonesArg: string
}

const bytes = (s: string) => new TextEncoder().encode(s).length
const roundUp = (value: number, step: number) => Math.ceil(value / step) * step

/**
 * Raw upper-bound model for CreateContract, before margins. The fixed part
 * (10,000 B, 30M gas) covers the contract record, the per-client slot counter,
 * the client index entry (about 2 KB) and the tree nodes rewritten on insert
 * with 5,000 open contracts (8,874 B and 28.6M measured for the smallest
 * contract there). Each milestone is stored as its own struct (under 900 bytes
 * measured) on top of its title; the encoded argument bounds the titles. Gas
 * grows by at most about 26,000 per argument byte, which the realm walks while
 * it validates and sanitises the text.
 */
export function estimateCreateContract(sizes: CreateContractSizes): { gas: number; storageBytes: number } {
    const argBytes = bytes(sizes.milestonesArg)
    const milestones = sizes.milestonesArg.split(",").length
    return {
        gas: 30_000_000 + 28_000 * (sizes.titleBytes + sizes.descriptionBytes + argBytes),
        storageBytes: 10_000 + sizes.titleBytes + sizes.descriptionBytes + 1_000 * milestones + argBytes,
    }
}

const budget = (gas: number, storageBytes: number): EscrowCallBudget => ({
    gasWanted: Math.min(ESCROW_MAX_CALL_GAS, roundUp(gas * 1.25, 1_000_000)),
    maxDepositUgnot: roundUp(storageBytes * 2 * STORAGE_PRICE_UGNOT, 10_000),
})

/** Gas limit and deposit cap for a CreateContract with these argument sizes. */
export function createContractBudget(sizes: CreateContractSizes): EscrowCallBudget {
    const { gas, storageBytes } = estimateCreateContract(sizes)
    return budget(gas, storageBytes)
}

/** Gas limit and deposit cap for any escrow call other than CreateContract. */
export function escrowCallBudget(func: EscrowFunc): EscrowCallBudget {
    if (!Object.prototype.hasOwnProperty.call(ESCROW_CALL_GAS_BASIS, func)) {
        throw new Error(`No flat budget for escrow function ${func}`)
    }
    return budget(ESCROW_CALL_GAS_BASIS[func as EscrowStateFunc], ESCROW_STATE_CALL_STORAGE_BYTES)
}

/** The stored text of a contract, as read back from the realm. */
export interface StoredContractText {
    titleBytes: number
    descriptionBytes: number
    /** UTF-8 byte length of each milestone title. */
    milestoneTitleBytes: readonly number[]
}

/**
 * About how many bytes ArchiveContract frees (the contract and its client
 * index entry), fitted to the measured archives: 6,718 B (1-byte title, one
 * 1-byte milestone), 7,610 B (two milestones) and 32,801 B (200 B title,
 * 5,000 B description, 20 × 200 B milestones; the fit gives 32,845). With many
 * contracts in the realm more tree bytes come back (9,073 B for the smallest
 * contract with 5,000 open), so this is an estimate, not a promise.
 */
export function estimateArchiveRefundBytes(text: StoredContractText): number {
    const titles = text.milestoneTitleBytes.reduce((sum, n) => sum + n, 0)
    return 5_825 + text.titleBytes + text.descriptionBytes + titles + 891 * text.milestoneTitleBytes.length
}

/**
 * About how much ArchiveContract refunds to the client. The chain refunds the
 * realm's average deposit per freed byte (its deposit over its storage), which
 * is the storage price as long as that price has not changed.
 */
export function estimateArchiveRefundUgnot(text: StoredContractText): number {
    return estimateArchiveRefundBytes(text) * STORAGE_PRICE_UGNOT
}
