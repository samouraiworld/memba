/**
 * One transaction plan per DAO call: the exact message to sign plus the gas
 * limit and deposit cap it is sent with. Forms preview `plan.msg` and submit
 * the same object, so what the member reviews is what the wallet signs.
 */
import { doContractBroadcast, type AminoMsg } from "../grc20"
import { buildDaoMsg, type DaoAction } from "./builders"
import type { DaoKind } from "./kind"
import { depositNeedsOverride, formatUgnotExact, v2CallBudget, V2_MAX_DEPOSIT_UGNOT, type V2ExecuteTarget } from "./v2Budget"

export interface DaoTxPlan {
    msg: AminoMsg
    /** Explicit gas limit; absent for contracts that use the profile default. */
    gasWanted?: number
    /** Storage deposit cap in ugnot, also carried in `msg.value.max_deposit`. */
    maxDepositUgnot?: number
}

export function planDaoTx(kind: DaoKind, realmPath: string, action: DaoAction, caller: string, executes?: V2ExecuteTarget): DaoTxPlan {
    return budgetDaoMsg(kind, buildDaoMsg(kind, realmPath, action, caller), action, executes)
}

/** Attach the gas limit and deposit cap to a message built for `action`. */
export function budgetDaoMsg(kind: DaoKind, msg: AminoMsg, action: DaoAction, executes?: V2ExecuteTarget): DaoTxPlan {
    if (kind !== "memba-v2") return { msg }
    const budget = v2CallBudget(action, executes)
    return {
        msg: { ...msg, value: { ...msg.value, max_deposit: `${budget.maxDepositUgnot}ugnot` } },
        gasWanted: budget.gasWanted,
        maxDepositUgnot: budget.maxDepositUgnot,
    }
}

/**
 * The storage-deposit cap the message itself carries, in ugnot: what the
 * wallet signs, not the preview field. Null when the message has no cap.
 * Throws on any other shape, or when the preview field disagrees with it.
 */
export function signedDepositUgnot(plan: DaoTxPlan): number | null {
    const raw = (plan.msg.value as Record<string, unknown>).max_deposit
    if (raw === undefined || raw === "") {
        if (plan.maxDepositUgnot !== undefined) throw new Error("The transaction does not carry the storage-deposit cap it was reviewed with. Review it again.")
        return null
    }
    const m = typeof raw === "string" ? /^(\d{1,15})ugnot$/.exec(raw) : null
    if (!m) throw new Error("The transaction carries a storage-deposit cap in an unexpected form. Review it again.")
    const ugnot = Number(m[1])
    if (plan.maxDepositUgnot !== undefined && plan.maxDepositUgnot !== ugnot) throw new Error("The transaction's storage-deposit cap differs from the one reviewed. Review it again.")
    return ugnot
}

/** True when this plan's deposit cap is above the 10 GNOT ceiling. */
export function planNeedsDepositOverride(plan: DaoTxPlan): boolean {
    const ugnot = signedDepositUgnot(plan)
    return ugnot !== null && depositNeedsOverride(ugnot)
}

/**
 * Refuse to sign a deposit cap above the ceiling unless the member approved
 * that exact amount. An approval of any other amount does not count.
 */
function assertDepositAllowed(plan: DaoTxPlan, approvedDepositUgnot?: number): void {
    const ugnot = signedDepositUgnot(plan)
    if (ugnot === null || !depositNeedsOverride(ugnot) || approvedDepositUgnot === ugnot) return
    throw new Error(`The storage-deposit cap of ${formatUgnotExact(ugnot)} is above the ${formatUgnotExact(V2_MAX_DEPOSIT_UGNOT)} limit. Approve that exact amount before signing.`)
}

export interface DaoSignOptions {
    /** The deposit cap, in ugnot, the member explicitly approved above the ceiling. */
    approvedDepositUgnot?: number
}

const isProposal = (action: DaoAction) => action.type.startsWith("propose-")

/** A plan with a deposit cap was sized for a version-2 realm. */
const isV2Plan = (plan: DaoTxPlan) => plan.maxDepositUgnot !== undefined

/**
 * Sign and broadcast a plan. Proposals are never re-sent automatically: a
 * response lost after the transaction landed would otherwise create the same
 * proposal twice. Version-2 votes and executions are not re-sent either: the
 * realm rejects a repeat deterministically, so a retry would only re-prompt
 * the wallet and pay another fee.
 */
export async function broadcastDaoTx(plan: DaoTxPlan, action: DaoAction, memo: string, beforeSign?: () => void | Promise<void>, sign: DaoSignOptions = {}) {
    const options = daoBroadcastOptions(plan, action, sign)
    return doContractBroadcast([plan.msg], memo, { ...options, ...(beforeSign ? { beforeSign } : {}) })
}

/**
 * Broadcast options for a plan (for callers that call doContractBroadcast
 * themselves). Throws when the plan's deposit cap is above the ceiling and was
 * not explicitly approved.
 */
export function daoBroadcastOptions(plan: DaoTxPlan, action: DaoAction, sign: DaoSignOptions = {}): { gasWanted?: number; retry?: false } {
    assertDepositAllowed(plan, sign.approvedDepositUgnot)
    return {
        ...(plan.gasWanted !== undefined ? { gasWanted: plan.gasWanted } : {}),
        ...(isProposal(action) || isV2Plan(plan) ? { retry: false as const } : {}),
    }
}

const record = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null)

function decodeResultData(data: unknown): string | null {
    if (typeof data !== "string" || data === "") return null
    if (/^\(\d+ uint64\)\s*$/.test(data)) return data
    try {
        return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(atob(data), (c) => c.charCodeAt(0)))
    } catch {
        return null
    }
}

/**
 * The new proposal id from a wallet's broadcast result: the Propose* call
 * returns `(N uint64)` as the deliver result data. Returns null when the
 * wallet's result does not carry it in a recognised shape.
 */
export function proposalIdFromTxResult(result: unknown): number | null {
    const root = record(result)
    if (!root) return null
    const candidates: unknown[] = []
    for (const key of ["deliver_tx", "deliverTx", "tx_result", "txResult"]) {
        const deliver = record(root[key])
        if (!deliver) continue
        const base = record(deliver.ResponseBase) ?? record(deliver.responseBase)
        candidates.push(base?.Data, base?.data, deliver.Data, deliver.data)
    }
    for (const candidate of candidates) {
        const text = decodeResultData(candidate)
        const m = text?.match(/^\((\d+) uint64\)\s*$/)
        if (!m) continue
        const id = Number(m[1])
        if (Number.isSafeInteger(id) && id > 0) return id
    }
    return null
}
