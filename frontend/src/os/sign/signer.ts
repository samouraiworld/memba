/**
 * The Memba OS signing driver (D15, D34). A request is reviewed in the OS
 * review sheet, then sent through the regular broadcaster with the OS sheet
 * standing in for the classic confirmation: the swapped-in callback approves
 * only messages identical to the reviewed ones, and puts the classic callback
 * back the moment it runs.
 *
 * Outcomes: sent (then verified), failed / cancelled (nothing reached the
 * wallet), or unknown (the wallet opened and we can't tell). DAO actions keep
 * the same governance receipts as the classic pages, so an unknown outcome
 * locks the action in both until the member checks it.
 *
 * @module os/sign/signer
 */
import { setTxConfirmationCallback, type AminoMsg } from "../../lib/grc20"
import {
    beginGovernanceRequest, clearGovernanceReceipt, governanceRequestActive, saveGovernanceReceipt, type GovernanceScope,
} from "../../lib/dao/governanceRecovery"
import { friendlyDaoError } from "../../lib/dao/errors"
import { sameMsgs } from "./decode"

export interface SignChoice<C extends string> { label: string; options: readonly C[]; initial: C }

export interface SignRequest<C extends string = string> {
    /** Sheet heading, e.g. "Vote". */
    title: string
    /** One line: what happens, e.g. Vote on #12 "Fund the programme". */
    summary: string
    sub?: string
    choice?: SignChoice<C>
    /** Plain-language facts for the chosen option: effect, network, fee, deposit cap. */
    lines: (choice: C | undefined) => [string, string][]
    warns?: string[]
    /** Each one must be ticked before signing. */
    acks?: string[]
    note?: string
    /** Short label for the tray and notifications, e.g. "Vote on #12". */
    label: (choice: C | undefined) => string
    /** DAO actions: the classic governance receipt that doubles as the unknown-outcome lock. */
    receipt?: GovernanceScope
    /** The exact messages for this choice (pure; throws with a user message if it can't). */
    prepare: (choice: C | undefined) => { msgs: AminoMsg[] }
    /** Fresh on-chain checks right before the wallet opens; throws to stop. */
    recheck?: (choice: C | undefined) => Promise<void>
    /** Sends exactly the prepared messages; must pass `beforeSign` to the broadcaster. */
    send: (choice: C | undefined, beforeSign: () => Promise<void>) => Promise<{ hash: string; result?: unknown }>
    /** After sending: does the chain show the result? Gets the wallet's result too (e.g. a new proposal's id). */
    verify?: (choice: C | undefined, hash: string, result: unknown) => Promise<boolean>
    /** How many times to run `verify` (default 3). Use 1 when `verify` polls by itself. */
    verifyAttempts?: number
    /** Nothing reached the chain (refused before the wallet, or rejected in it): drop what `send` saved. */
    onNothingSent?: () => void
    onSettled?: (outcome: SettledOutcome, choice: C | undefined) => void
}

export type SignResult =
    | { outcome: "sent"; hash: string; result?: unknown }
    | { outcome: "failed" | "cancelled"; error: string }
    | { outcome: "unknown"; error: string; hash: string }

export type SettledOutcome = "confirmed" | "submitted" | "failed" | "cancelled" | "unknown"

const REJECTED_IN_WALLET = /user (rejected|denied)|rejected by (the )?user/i

/** Review → wallet → result. `onWallet` fires when the rechecks passed and Adena is about to open. */
export async function executeSignature<C extends string>(
    req: SignRequest<C>,
    choice: C | undefined,
    reviewed: readonly AminoMsg[],
    onWallet: () => void,
): Promise<SignResult> {
    const label = req.label(choice)
    let walletStarted = false
    let hash = ""
    let mismatch = false
    let restored = false
    let finish = () => {}
    const previous = setTxConfirmationCallback(async (msgs) => {
        setTxConfirmationCallback(previous)
        restored = true
        mismatch = !sameMsgs(msgs, reviewed)
        return !mismatch
    })
    try {
        if (req.receipt) {
            if (governanceRequestActive(req.receipt)) return { outcome: "failed", error: "This action is already waiting for Adena." }
            finish = beginGovernanceRequest(req.receipt)
            // Durable before the wallet opens, as on the classic pages.
            saveGovernanceReceipt(req.receipt, { phase: "intent", hash: "", label })
        }
        const res = await req.send(choice, async () => {
            await req.recheck?.(choice)
            walletStarted = true
            onWallet()
        })
        hash = res.hash
        if (req.receipt) {
            try { saveGovernanceReceipt(req.receipt, { phase: "submitted", hash, label }) } catch { /* kept in memory by governanceRecovery */ }
        }
        return { outcome: "sent", hash, result: res.result }
    } catch (err) {
        const raw = err instanceof Error ? err.message : String(err)
        const nothingSent = (!walletStarted && !hash) || REJECTED_IN_WALLET.test(raw)
        if (nothingSent) {
            finish()
            if (req.receipt) { try { clearGovernanceReceipt(req.receipt) } catch { /* keep the conservative lock */ } }
            try { req.onNothingSent?.() } catch { /* keep whatever lock the request saved */ }
            if (mismatch) return { outcome: "failed", error: "The transaction changed after your review. Nothing was sent. Review it again." }
            if (/cancelled/i.test(raw) || REJECTED_IN_WALLET.test(raw)) return { outcome: "cancelled", error: "Cancelled. Nothing was sent." }
            return { outcome: "failed", error: friendlyDaoError(err) }
        }
        return { outcome: "unknown", error: friendlyDaoError(err), hash }
    } finally {
        if (!restored) setTxConfirmationCallback(previous)
        finish()
    }
}

/** Retry verification a few times: the indexer and RPC trail the block by a few seconds. */
export async function verifyWithRetries(check: () => Promise<boolean>, attempts = 3, delayMs = 2500): Promise<boolean> {
    for (let i = 0; i < attempts; i++) {
        try { if (await check()) return true } catch { /* try again */ }
        if (i < attempts - 1) await new Promise((r) => setTimeout(r, delayMs))
    }
    return false
}
