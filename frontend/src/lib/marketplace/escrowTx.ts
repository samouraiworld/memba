/**
 * One transaction plan per escrow call: the exact message to sign, its gas limit,
 * its storage-deposit cap and the ugnot it sends. Screens preview the plan and
 * submit the same object; `assertEscrowPlanSignable` re-derives the budget from
 * the message and refuses anything that differs from what was reviewed.
 */
import { doContractBroadcast } from "../grc20"
import { signedDepositUgnot } from "../dao/daoTx"
import { depositNeedsOverride, formatUgnotExact, V2_MAX_DEPOSIT_UGNOT } from "../dao/v2Budget"
import {
    buildCancelContractMsg,
    buildClaimDisputeTimeoutMsg,
    buildClaimRefundMsg,
    buildCompleteMilestoneMsg,
    buildCreateContractMsg,
    buildFundMilestoneMsg,
    buildRaiseDisputeMsg,
    buildReleaseFundsMsg,
    parseMilestonesArg,
    type EscrowMilestone,
    type EscrowMsgCall,
} from "./builders"
import { createContractBudget, escrowCallBudget, ESCROW_CALL_MEASURED_GAS, type EscrowFunc } from "./escrowBudget"

export interface EscrowTxPlan {
    msg: EscrowMsgCall
    gasWanted: number
    /** Storage deposit cap in ugnot, also carried in `msg.value.max_deposit`. */
    maxDepositUgnot: number
    /** Ugnot sent with the call, also carried in `msg.value.send`: the milestone amount for FundMilestone, else 0. */
    sendUgnot: number
}

const bytes = (s: string) => new TextEncoder().encode(s).length

/** The budget a message needs, derived from its function and arguments alone. */
function budgetFor(msg: EscrowMsgCall) {
    const { func, args } = msg.value
    if (func === "CreateContract") {
        if (!Array.isArray(args) || args.length !== 4 || args.some((a) => typeof a !== "string")) throw new Error("Malformed CreateContract arguments. Review it again.")
        return createContractBudget({ titleBytes: bytes(args[1]), descriptionBytes: bytes(args[2]), milestonesArg: args[3] })
    }
    return escrowCallBudget(func)
}

function plan(msg: EscrowMsgCall, sendUgnot = 0): EscrowTxPlan {
    const { gasWanted, maxDepositUgnot } = budgetFor(msg)
    const p = { msg, gasWanted, maxDepositUgnot, sendUgnot }
    assertEscrowPlanSignable(p)
    return p
}

const KNOWN: ReadonlySet<string> = new Set<EscrowFunc>(["CreateContract", ...(Object.keys(ESCROW_CALL_MEASURED_GAS) as EscrowFunc[])])

/**
 * Refuse to sign a plan whose message is not exactly the one reviewed: the
 * deposit cap, send amount and gas limit must be the canonical values derived
 * from the message, the cap must be within the 10 GNOT ceiling (no escrow call
 * can legitimately exceed it, so there is no override), and only FundMilestone
 * may send coins.
 */
export function assertEscrowPlanSignable(p: EscrowTxPlan): void {
    const { msg } = p
    if (msg?.type !== "vm/MsgCall" || !KNOWN.has(msg.value?.func)) throw new Error("Not an escrow call. Review it again.")
    // Same strict read the DAO flows use; the exact-string check below also refuses leading zeros.
    const signed = signedDepositUgnot(p)
    if (signed === null || msg.value.max_deposit !== `${p.maxDepositUgnot}ugnot`) {
        throw new Error("The transaction does not carry the storage-deposit cap it was reviewed with. Review it again.")
    }
    if (depositNeedsOverride(signed)) {
        throw new Error(`The storage-deposit cap of ${formatUgnotExact(signed)} is above the ${formatUgnotExact(V2_MAX_DEPOSIT_UGNOT)} limit.`)
    }
    const needed = budgetFor(msg)
    if (needed.maxDepositUgnot !== p.maxDepositUgnot || needed.gasWanted !== p.gasWanted) {
        throw new Error("The transaction changed after it was reviewed. Review it again.")
    }
    const payable = msg.value.func === "FundMilestone"
    if (!Number.isSafeInteger(p.sendUgnot) || (payable ? p.sendUgnot <= 0 : p.sendUgnot !== 0)) {
        throw new Error("The transaction sends an unexpected amount. Review it again.")
    }
    const expectedSend = payable ? `${p.sendUgnot}ugnot` : ""
    if (msg.value.send !== expectedSend) {
        throw new Error("The amount the transaction sends differs from the one reviewed. Review it again.")
    }
}

/**
 * Sign and broadcast a plan. Escrow calls are never re-sent automatically: a
 * response lost after CreateContract landed would create a second contract, and
 * every other call is rejected deterministically on a repeat.
 */
export async function broadcastEscrowTx(p: EscrowTxPlan, memo: string, beforeSign?: () => void | Promise<void>) {
    assertEscrowPlanSignable(p)
    return doContractBroadcast([p.msg], memo, { gasWanted: p.gasWanted, retry: false, ...(beforeSign ? { beforeSign } : {}) })
}

export interface CreateContractInput {
    freelancer: string
    title: string
    description: string
    milestones: readonly EscrowMilestone[]
}

export function planCreateContract(caller: string, escrowPath: string, input: CreateContractInput): EscrowTxPlan {
    return plan(buildCreateContractMsg(caller, escrowPath, input.freelancer, input.title, input.description, input.milestones))
}

/** A service listing, with its milestones in the realm's `title:amount,…` form. */
export interface HireableService {
    freelancer: string
    title: string
    description: string
    milestones: string
}

export interface HirePlan extends EscrowTxPlan {
    milestones: EscrowMilestone[]
    /** Sum of the milestone amounts, funded later one milestone at a time. */
    totalUgnot: number
}

/** Plan the CreateContract that hires a listing's freelancer on its milestones. */
export function planHireService(caller: string, escrowPath: string, service: HireableService): HirePlan {
    const milestones = parseMilestonesArg(service.milestones)
    const p = planCreateContract(caller, escrowPath, { freelancer: service.freelancer, title: service.title, description: service.description, milestones })
    return { ...p, milestones, totalUgnot: milestones.reduce((sum, m) => sum + m.amountUgnot, 0) }
}

/**
 * `amountUgnot` must be the milestone amount stored in the realm (read from the
 * chain), never a figure typed by the user: the realm rejects any other amount.
 */
export function planFundMilestone(caller: string, escrowPath: string, contractId: string, milestoneIdx: number, amountUgnot: number): EscrowTxPlan {
    const msg = buildFundMilestoneMsg(caller, escrowPath, contractId, milestoneIdx, amountUgnot)
    return plan(msg, amountUgnot)
}

export const planCompleteMilestone = (caller: string, escrowPath: string, contractId: string, milestoneIdx: number) =>
    plan(buildCompleteMilestoneMsg(caller, escrowPath, contractId, milestoneIdx))

export const planReleaseFunds = (caller: string, escrowPath: string, contractId: string, milestoneIdx: number) =>
    plan(buildReleaseFundsMsg(caller, escrowPath, contractId, milestoneIdx))

export const planRaiseDispute = (caller: string, escrowPath: string, contractId: string, milestoneIdx: number) =>
    plan(buildRaiseDisputeMsg(caller, escrowPath, contractId, milestoneIdx))

export const planCancelContract = (caller: string, escrowPath: string, contractId: string) =>
    plan(buildCancelContractMsg(caller, escrowPath, contractId))

export const planClaimRefund = (caller: string, escrowPath: string, contractId: string, milestoneIdx: number) =>
    plan(buildClaimRefundMsg(caller, escrowPath, contractId, milestoneIdx))

export const planClaimDisputeTimeout = (caller: string, escrowPath: string, contractId: string, milestoneIdx: number) =>
    plan(buildClaimDisputeTimeoutMsg(caller, escrowPath, contractId, milestoneIdx))
