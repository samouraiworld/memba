/**
 * One transaction plan per DAO call: the exact message to sign plus the gas
 * limit and deposit cap it is sent with. Forms preview `plan.msg` and submit
 * the same object, so what the member reviews is what the wallet signs.
 */
import { doContractBroadcast, type AminoMsg } from "../grc20"
import { buildDaoMsg, type DaoAction } from "./builders"
import type { DaoKind } from "./kind"
import { v2CallBudget, type V2ExecuteTarget } from "./v2Budget"

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

const isProposal = (action: DaoAction) => action.type.startsWith("propose-")

/**
 * Sign and broadcast a plan. Proposals are never re-sent automatically: a
 * response lost after the transaction landed would otherwise create the same
 * proposal twice.
 */
export function broadcastDaoTx(plan: DaoTxPlan, action: DaoAction, memo: string) {
    return doContractBroadcast([plan.msg], memo, daoBroadcastOptions(plan, action))
}

/** Broadcast options for a plan (for callers that call doContractBroadcast themselves). */
export function daoBroadcastOptions(plan: DaoTxPlan, action: DaoAction): { gasWanted?: number; retry?: false } {
    return {
        ...(plan.gasWanted !== undefined ? { gasWanted: plan.gasWanted } : {}),
        ...(isProposal(action) ? { retry: false as const } : {}),
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
