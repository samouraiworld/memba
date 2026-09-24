/**
 * Gas limit and storage-deposit cap for each call into escrow_v3.
 *
 * gno.land mainnet charges a storage deposit on every call that grows realm
 * state, and a call without `max_deposit` lets the chain lock up to its 100 GNOT
 * default. Only CreateContract grows state by much: it stores the title,
 * description and milestone titles. Every other call changes a few status
 * fields and block heights (at most 43 bytes measured).
 *
 * Measured on an in-memory gnoland node built from the gnoland-1 runtime pin
 * (e75fef82) against the deployed escrow_v3 source, filling the realm to its
 * 500-contract limit with the largest contracts it accepts:
 *
 *   CreateContract  3,471 B (smallest) to 29,130 B (200 B title, 5,000 B
 *                   description, 20 milestones with 200 B titles);
 *                   5.2M to 261.3M gas, growing with the argument bytes
 *   FundMilestone   ≤ 35 B, ≤ 11.17M gas   CompleteMilestone  ≤ 41 B, ≤ 10.53M
 *   ReleaseFunds    ≤ 2 B,  ≤ 12.96M       RaiseDispute       ≤ 37 B, ≤ 10.53M
 *   CancelContract  ≤ 43 B, ≤ 16.25M       ClaimRefund        ≤ 5 B,  ≤ 11.20M
 *   ClaimDisputeTimeout ≤ 1 B, ≤ 14.26M
 *
 * `escrowBudget.test.ts` checks every measured point against these models.
 * Deposit caps are twice the storage estimate at 100 ugnot per byte, rounded up
 * to 0.01 GNOT; gas limits carry a 25 % margin, rounded up to 1M. The chain
 * locks only the bytes a call really adds, so the cap is a ceiling, not a
 * price. The largest contract the realm accepts caps at 6.91 GNOT, under the
 * 10 GNOT ceiling, so no escrow call ever needs an override.
 */
import { STORAGE_PRICE_UGNOT } from "../dao/v2Budget"

/** The escrow_v3 entrypoints Memba signs for a user. */
export type EscrowFunc =
    | "CreateContract"
    | "FundMilestone"
    | "CompleteMilestone"
    | "ReleaseFunds"
    | "RaiseDispute"
    | "CancelContract"
    | "ClaimRefund"
    | "ClaimDisputeTimeout"

export type EscrowStateFunc = Exclude<EscrowFunc, "CreateContract">

/** Largest gas used per call, measured at 500 max-size contracts. */
export const ESCROW_CALL_MEASURED_GAS: Record<EscrowStateFunc, number> = {
    FundMilestone: 11_167_344,
    CompleteMilestone: 10_526_168,
    ReleaseFunds: 12_961_475,
    RaiseDispute: 10_530_584,
    CancelContract: 16_251_740,
    ClaimRefund: 11_199_876,
    ClaimDisputeTimeout: 14_259_406,
}

/**
 * Storage estimate for every call but CreateContract: over 20 times the largest
 * delta measured, which leaves room for block heights and totals that take more
 * bytes on mainnet than on a fresh test node.
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
 * Raw upper-bound model for CreateContract, before margins. Each milestone is
 * stored as its own struct (about 800 bytes measured) on top of its title; the
 * encoded argument bounds the titles. Gas grows by about 27,000 per argument
 * byte, which the realm walks while it validates and sanitises the text.
 */
export function estimateCreateContract(sizes: CreateContractSizes): { gas: number; storageBytes: number } {
    const argBytes = bytes(sizes.milestonesArg)
    const milestones = sizes.milestonesArg.split(",").length
    return {
        gas: 12_000_000 + 28_000 * (sizes.titleBytes + sizes.descriptionBytes + argBytes),
        storageBytes: 5_000 + sizes.titleBytes + sizes.descriptionBytes + 1_000 * milestones + argBytes,
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
    if (!Object.prototype.hasOwnProperty.call(ESCROW_CALL_MEASURED_GAS, func)) {
        throw new Error(`No flat budget for escrow function ${func}`)
    }
    return budget(ESCROW_CALL_MEASURED_GAS[func as EscrowStateFunc], ESCROW_STATE_CALL_STORAGE_BYTES)
}
