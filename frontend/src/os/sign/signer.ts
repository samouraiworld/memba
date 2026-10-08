/**
 * The Memba OS signing driver (D15, D34). A request is reviewed in the OS
 * review sheet, then sent through the regular broadcaster with the OS sheet
 * standing in for the classic confirmation: the swapped-in callback approves
 * only messages identical to the reviewed ones, and puts the classic callback
 * back the moment it runs.
 *
 * Outcomes: sent (then verified); failed / cancelled; refused (the wallet
 * sent it and the node refused it, with its reason); or unknown (the wallet
 * opened and we can't tell). Before the wallet opens, "nothing was sent" is a
 * fact. After it opened, a "rejected" reply is not proof: Adena gives it
 * whenever its window closes, also after Confirm. It counts as cancelled only
 * when the account is unchanged three blocks later (see SentCheck), and is
 * then reported as that observation, not as a proof. DAO actions keep the
 * same governance receipts as the classic pages, so an unknown outcome locks
 * the action in both until the member checks it.
 *
 * @module os/sign/signer
 */
import { ChainRejectedError, replaceTxConfirmationCallback, setTxConfirmationCallback, WalletActionBlockedError, type AminoMsg } from "../../lib/grc20"
import {
    beginGovernanceRequest, clearGovernanceReceipt, governanceRequestActive, saveGovernanceReceipt, type GovernanceScope,
} from "../../lib/dao/governanceRecovery"
import { friendlyDaoError } from "../../lib/dao/errors"
import { sameMsgs } from "./decode"
import { WalletNetworkError } from "../../lib/walletNetworkGuard"

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
    /** A creation receipt with a transaction-correlated ID stays until the member starts another action. */
    retainConfirmedReceipt?: boolean
    /** The exact messages for this choice (pure; throws with a user message if it can't). */
    prepare: (choice: C | undefined) => { msgs: AminoMsg[] }
    /** Fresh on-chain checks right before the wallet opens; throws to stop. */
    recheck?: (choice: C | undefined) => Promise<void>
    /** Sends exactly the prepared messages; must pass `beforeSign` to the broadcaster. */
    send: (choice: C | undefined, beforeSign: () => Promise<void | (() => boolean)>) => Promise<{ hash: string; result?: unknown }>
    /** After sending: what the chain shows. `true`: the result is there; `false`: not yet; `"failed"`: the chain ran
     *  the transaction and refused it (final: not asked again). Gets the wallet's result too (e.g. a new proposal's id). */
    verify?: (choice: C | undefined, hash: string, result: unknown) => Promise<boolean | "failed">
    /** How many times to run `verify` (default 3). Use 1 when `verify` polls by itself. */
    verifyAttempts?: number
    /** What the tray says when `verify` answers "not yet" (`false`), when the request knows more than that. */
    pendingNote?: () => string | undefined
    /** What the tray says when `verify` answers `"failed"`, when the request knows why. */
    failedNote?: () => string | undefined
    /** The tray's and toast's heading for a `"failed"` answer when the transaction itself went through
     *  but its purpose didn't (default "Refused by the network"). */
    failedTitle?: () => string | undefined
    /** Nothing took effect (stopped before the wallet, rejected in it, or refused by the node): drop what `send` saved. */
    onNothingSent?: () => void
    onSettled?: (outcome: SettledOutcome, choice: C | undefined) => void
    /** The review was closed without signing (Cancel or Escape on the sheet). */
    onDismissed?: () => void
}

export type SignResult =
    /** `seenOnChain`: the wallet never answered, but the account sent a transaction while it was open (`hash` is then ""). */
    | { outcome: "sent"; hash: string; result?: unknown; seenOnChain?: true }
    | { outcome: "failed" | "cancelled"; error: string }
    /** Signed, sent, and refused by the node: final. `error` carries the node's reason. */
    | { outcome: "refused"; error: string }
    /** `hash` when the transaction is known to exist (an EVM wallet error can leave it unknown). */
    | { outcome: "unknown"; error: string; hash?: string }

export type SettledOutcome = "confirmed" | "submitted" | "failed" | "cancelled" | "unknown"

/**
 * The node's refusal in its own words, and what it means: the wallet is never
 * asked to wait for the block, so a refusal is one at the node's door (see
 * ChainRejectedError). The same request would be refused again.
 */
function refusalText(err: ChainRejectedError): string {
    return `The network refused this transaction: ${err.reason.replace(/[.\s]+$/, "")}. It was not included in a block, so nothing changed and no network fee was charged. Review the request before trying again.`
}

/**
 * How a "rejected" reply is checked. Both reads return what any transaction
 * from the account changes, as one comparable value (see accountMark).
 */
export interface SentCheck {
    /** The account now; read before the wallet opens. */
    before: () => Promise<string>
    /** The account three blocks after the call; rejects when the chain does not get there in time. */
    after: () => Promise<string>
    /** The wallet answered "rejected" and the account is being checked. */
    onSettling?: () => void
    /** Aborted when nobody waits for the answer any more: the watch on a silent wallet stops. */
    stop?: AbortSignal
}

/** A slow node must not hold the wallet back: past this the first read counts as missing. */
const FIRST_READ_MS = 3000
/**
 * How long the wallet must stay silent before the account may answer for it. While the
 * person reads Adena's window, the sequence can move for another transaction (another tab,
 * a previous one still landing): a wallet that answers inside this time always decides.
 */
export const WALLET_QUIET_MS = 45_000
/** After that, how often the account is read to see whether it sent a transaction. */
export const WATCH_MS = 3000
/** How long a wallet may stay silent before Memba stops waiting and says what to check. */
export const WALLET_SILENT_MS = 3 * 60_000
const SILENT_UNCHANGED = "Adena has not answered for 3 minutes, and your account shows no new transaction. If Adena is still open, finish or close the request there, then check your account before trying again."
const SILENT_UNREAD = "Adena has not answered for 3 minutes, and Memba could not read your account to tell whether it sent a transaction. If Adena is still open, finish or close the request there, then check your account before trying again."
const SILENT_MOVED = "Adena has not answered for 3 minutes, and your account shows a new transaction Memba could not confirm. If Adena is still open, finish or close the request there, then check its result in your account's history before trying again."
const STOPPED = "Memba stopped waiting for Adena. Check your account before trying again."

/** The account's sequence in a mark ("<sequence> <coins>"): it moves only when the account itself signs a transaction. */
function sequenceOf(mark: string): bigint | null {
    const s = mark.split(" ")[0]
    return /^\d+$/.test(s) ? BigInt(s) : null
}

const REJECTED_IN_WALLET = /user (rejected|denied|cancelled|canceled)|rejected by (the )?user|^(transaction )?cancelled by (the )?user$/i
let signingActive = false

/** A request that stopped before anything reached the chain: the reason, and that nothing was sent (a failed read says only the first). */
function nothingSentFailure(err: unknown): SignResult {
    const said = friendlyDaoError(err)
    if (/nothing was sent/i.test(said)) return { outcome: "failed", error: said }
    return { outcome: "failed", error: `${/[.!?]$/.test(said) ? said : `${said}.`} Nothing was sent.` }
}

/** Review → wallet → result. `onWallet` fires when the rechecks passed and Adena is about to open. */
export async function executeSignature<C extends string>(
    req: SignRequest<C>,
    choice: C | undefined,
    reviewed: readonly AminoMsg[],
    onWallet: () => void,
    /** Checked after asynchronous chain rechecks and immediately before Adena opens. */
    canOpenWallet: () => boolean = () => true,
    /** Without it, a "rejected" reply after the wallet opened is an unknown outcome. */
    sent?: SentCheck,
): Promise<SignResult> {
    if (signingActive) return { outcome: "failed", error: "A signature is already waiting. Finish it before starting another." }
    signingActive = true
    let label: string
    try { label = req.label(choice) } catch (err) {
        signingActive = false
        return nothingSentFailure(err)
    }
    let walletStarted = false
    let markBefore: string | null = null
    let hash = ""
    let mismatch = false
    let restored = false
    let finish = () => {}
    // Once the wallet has the request, its answer races the chain: a wallet that never
    // answers (Adena's promise left pending) must not hold the flow when the account
    // has already sent the transaction, nor forever when nothing happened.
    let stopWatch = () => {}
    let startWatch = () => {}
    // What the last read of the account showed, for the timeout's wording.
    let lastRead: "unchanged" | "moved" | "unread" = "unread"
    const chainWatch = new Promise<"landed" | "silent" | "stopped">((resolve) => {
        startWatch = () => {
            const opened = Date.now()
            let timer: ReturnType<typeof setTimeout> | undefined
            let stopped = false
            // A moved sequence counts only when the next read agrees: one node's answer is not enough.
            let moved: bigint | null = null
            const halt = () => { stopped = true; clearTimeout(timer); resolve("stopped") }
            stopWatch = () => { stopped = true; clearTimeout(timer); sent?.stop?.removeEventListener("abort", halt) }
            if (sent?.stop?.aborted) { halt(); return }
            sent?.stop?.addEventListener("abort", halt, { once: true })
            const tick = async () => {
                if (stopped) return
                const before = markBefore === null ? null : sequenceOf(markBefore)
                if (sent && before !== null) {
                    const now = await sent.before().then(sequenceOf, () => null)
                    if (stopped) return
                    lastRead = now === null || now < before ? "unread" : now === before ? "unchanged" : "moved"
                    if (now !== null && now > before && now === moved) { resolve("landed"); return }
                    moved = now !== null && now > before ? now : null
                }
                if (Date.now() - opened >= WALLET_SILENT_MS) { resolve("silent"); return }
                timer = setTimeout(() => { void tick() }, WATCH_MS)
            }
            timer = setTimeout(() => { void tick() }, WALLET_QUIET_MS)
        }
    })
    const confirm = async (msgs: AminoMsg[]) => {
        replaceTxConfirmationCallback(confirm, previous)
        restored = true
        mismatch = !sameMsgs(msgs, reviewed)
        return !mismatch
    }
    const previous = setTxConfirmationCallback(confirm)
    try {
        if (req.receipt) {
            if (governanceRequestActive(req.receipt)) return { outcome: "failed", error: "This action is already waiting for Adena." }
            finish = beginGovernanceRequest(req.receipt)
            // Durable before the wallet opens, as on the classic pages.
            saveGovernanceReceipt(req.receipt, { phase: "intent", hash: "", label })
        }
        const sending = req.send(choice, async () => {
            // Without this read a later "rejected" reply cannot be confirmed, and is reported as unknown.
            // It runs alongside the request's rechecks: one wait before the wallet opens, not two.
            const marking = (async () => {
                if (!sent) return
                let timer: ReturnType<typeof setTimeout> | undefined
                markBefore = await Promise.race([
                    sent.before().catch(() => null),
                    new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), FIRST_READ_MS) }),
                ])
                clearTimeout(timer)
            })()
            await Promise.all([marking, req.recheck?.(choice)])
            if (!canOpenWallet()) throw new Error("Your Memba session ended. Connect again before signing.")
            if (!restored) throw new Error("Signature review expired. Try again.")
            walletStarted = true
            onWallet()
            startWatch()
            return canOpenWallet
        })
        const answer = await Promise.race([sending.then((r) => ({ wallet: r })), chainWatch.then((c) => ({ chain: c }))])
        if ("chain" in answer) { // a later wallet answer no longer decides; the race keeps it handled
            if (answer.chain === "stopped") return { outcome: "unknown", error: STOPPED, hash }
            if (answer.chain === "silent") return { outcome: "unknown", error: { unchanged: SILENT_UNCHANGED, moved: SILENT_MOVED, unread: SILENT_UNREAD }[lastRead], hash }
            if (req.receipt) {
                try { saveGovernanceReceipt(req.receipt, { phase: "submitted", hash: "", label }) } catch { /* kept in memory by governanceRecovery */ }
            }
            return { outcome: "sent", hash: "", seenOnChain: true }
        }
        const res = answer.wallet
        hash = res.hash
        if (req.receipt) {
            try { saveGovernanceReceipt(req.receipt, { phase: "submitted", hash, label }) } catch { /* kept in memory by governanceRecovery */ }
        }
        return { outcome: "sent", hash, result: res.result }
    } catch (err) {
        const raw = err instanceof Error ? err.message : String(err)
        const rejected = REJECTED_IN_WALLET.test(raw)
        // A wallet-network refusal is thrown before the wallet is asked to sign.
        let nothingSent = (!walletStarted && !hash) || err instanceof WalletNetworkError || err instanceof WalletActionBlockedError
        if (!nothingSent && rejected) {
            sent?.onSettling?.()
            const before = markBefore
            nothingSent = !!sent && before !== null && await sent.after().then((after) => after === before, () => false)
            if (!nothingSent) return { outcome: "unknown", error: "Adena reported a cancellation, but Memba could not confirm it on chain. Check your account before trying again.", hash }
        }
        // Refused by the node: nothing took effect, so the lock is released as for nothing sent.
        const refused = err instanceof ChainRejectedError
        if (nothingSent || refused) {
            finish()
            if (req.receipt) { try { clearGovernanceReceipt(req.receipt) } catch { /* keep the conservative lock */ } }
            try { req.onNothingSent?.() } catch { /* keep whatever lock the request saved */ }
            if (refused) return { outcome: "refused", error: refusalText(err) }
            if (mismatch) return { outcome: "failed", error: "The transaction changed after your review. Nothing was sent. Review it again." }
            // After the wallet opened, only what was observed is said: an accepted transaction has no deadline to be included.
            if (walletStarted && rejected) return { outcome: "cancelled", error: "Cancelled in Adena. Your account shows no change three blocks later." }
            if (/cancelled/i.test(raw) || rejected) return { outcome: "cancelled", error: "Cancelled. Nothing was sent." }
            return nothingSentFailure(err)
        }
        return { outcome: "unknown", error: friendlyDaoError(err), hash }
    } finally {
        stopWatch()
        if (!restored) replaceTxConfirmationCallback(confirm, previous)
        finish()
        signingActive = false
    }
}

/** Retry verification a few times: the indexer and RPC trail the block by a few seconds. */
export async function verifyWithRetries(check: () => Promise<boolean | "failed">, attempts = 3, delayMs = 2500): Promise<boolean | "failed"> {
    for (let i = 0; i < attempts; i++) {
        try {
            const seen = await check()
            if (seen !== false) return seen
        } catch { /* try again */ }
        if (i < attempts - 1) await new Promise((r) => setTimeout(r, delayMs))
    }
    return false
}
