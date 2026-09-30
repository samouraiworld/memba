/**
 * A GNOT send as a signing request (D15, D17, D37): the Memba review with the
 * tiered address check, the exact `/bank.MsgSend`, a lock saved before the
 * wallet opens (an unknown outcome holds the Send window until checked), and
 * no automatic retry: a retried send could pay twice.
 *
 * @module os/wallet/sendRequest
 */
import { GNO_CHAIN_ID } from "../../lib/config"
import { resolveRecipient } from "../../lib/nameResolve"
import { assertFeeStillCovers, doContractBroadcast } from "../../lib/grc20"
import { abciErrorPresent, resilientRpcCall } from "../../lib/rpcFallback"
import { normalizeTxHashHex } from "../../lib/txExplorerUrl"
import type { SignRequest } from "../sign/signer"
import { buildSendMsg, claimSendLock, clearSendLock, formatUgnot, SEND_GAS_WANTED, updateSendLockHash } from "./send"

export interface SendContext {
    from: string
    to: string
    /** The @name the member typed (D23), shown with the address; looked up again before the wallet opens. */
    toName?: string
    /** The registry lookup used for that re-check: the address, "" when no longer registered, null when
     *  unreadable (defaults to the shared resolveRecipient; injectable for tests). */
    resolveName?: (name: string) => Promise<string | null>
    ugnot: bigint
    memo: string
    feeUgnot: bigint
    tiers: string[]
    /** The wallet's account right now, asked of the wallet itself; the send stops if it changed since the review. */
    currentWallet: () => Promise<string>
    /** Fresh chain fee quote checked after review; a rise requires a new review. */
    currentFee?: () => Promise<bigint>
    onSent: (hash: string) => void
    saveRecipient?: boolean
}

/** The shared resolver (#1305), reduced to what the re-check needs. */
async function resolveNameNow(name: string): Promise<string | null> {
    const r = await resolveRecipient(`@${name}`)
    if (r.kind === "address") return r.name ? r.address : null
    return r.kind === "unregistered" ? "" : null
}

/** A wallet success is only submission; the chain's matching delivered tx is confirmation. */
export async function verifySendTx(hash: string, readTx: typeof resilientRpcCall = resilientRpcCall): Promise<boolean> {
    const hex = normalizeTxHashHex(hash)
    if (!hex) return false
    const raw = await readTx("tx", { hash: `0x${hex}` })
    if (!raw || typeof raw !== "object") return false
    const tx = raw as { hash?: unknown; height?: unknown; tx_result?: { ResponseBase?: { Error?: unknown } } }
    const height = typeof tx.height === "string" ? Number(tx.height) : tx.height
    return typeof tx.hash === "string" && normalizeTxHashHex(tx.hash) === hex &&
        typeof height === "number" && Number.isSafeInteger(height) && height > 0 &&
        !!tx.tx_result?.ResponseBase && Object.hasOwn(tx.tx_result.ResponseBase, "Error") &&
        !abciErrorPresent(tx.tx_result.ResponseBase.Error)
}

export function sendRequest(ctx: SendContext): SignRequest<string> {
    const amount = formatUgnot(ctx.ugnot)
    const msgs = [buildSendMsg(ctx.from, ctx.to, ctx.ugnot)]
    const label = `Send ${amount}`
    const who = ctx.toName ? `@${ctx.toName} · ${ctx.to}` : ctx.to
    const attemptId = crypto.randomUUID()
    return {
        title: "Send",
        summary: `Send ${amount}`,
        sub: ctx.toName ? `to @${ctx.toName} (${ctx.to})` : `to ${ctx.to}`,
        lines: () => [
            ["To", who],
            ["Amount", amount],
            ["Network", GNO_CHAIN_ID],
            ["Network fee", formatUgnot(ctx.feeUgnot)],
            ...(ctx.memo ? [["Memo", ctx.memo] as [string, string]] : []),
        ],
        warns: ctx.tiers.includes("new address") ? ["You have never sent to this address. Transfers can't be reversed."] : [],
        acks: ctx.tiers.length ? [`I checked the full address with the recipient${ctx.tiers.includes("100 GNOT or more") ? ", and the amount" : ""}.`] : [],
        note: "Adena shows this as a Transfer.",
        label: () => label,
        prepare: () => ({ msgs }),
        recheck: async () => {
            if ((await ctx.currentWallet()) !== ctx.from) throw new Error("Your wallet changed since the review. Review the send again.")
            if (ctx.currentFee) await assertFeeStillCovers(ctx.feeUgnot, ctx.currentFee)
            // A name can change owner: the address reviewed is the one paid, but only while the name still points there.
            if (ctx.toName) {
                const now = await (ctx.resolveName ?? resolveNameNow)(ctx.toName)
                if (now === null) throw new Error(`Couldn't confirm @${ctx.toName} just now. Nothing was sent; try again.`)
                if (now === "") throw new Error(`@${ctx.toName} is no longer registered. Nothing was sent.`)
                if (now !== ctx.to) throw new Error(`@${ctx.toName} now points to another address. Nothing was sent; review the send again.`)
            }
        },
        send: async (_c, beforeSign) => {
            // Web Locks serialize tabs in the same browser profile. The durable
            // record survives a crash and holds any outcome the chain has not confirmed.
            if (!navigator.locks?.request) throw new Error("This browser cannot safely coordinate sends across tabs.")
            return navigator.locks.request(`memba_os_send:${GNO_CHAIN_ID}:${ctx.from}`, { mode: "exclusive" }, async () => {
                claimSendLock(GNO_CHAIN_ID, ctx.from, { id: attemptId, label, hash: "", at: Date.now(), to: ctx.to, save: !!ctx.saveRecipient })
                const res = await doContractBroadcast(msgs, ctx.memo, { gasWanted: SEND_GAS_WANTED, gasFee: Number(ctx.feeUgnot), beforeSign })
                if (!normalizeTxHashHex(res.hash)) throw new Error("Adena did not return a valid transaction hash. Check the outcome before sending again.")
                updateSendLockHash(GNO_CHAIN_ID, ctx.from, attemptId, res.hash)
                return res
            })
        },
        verify: async (_choice, hash) => {
            const confirmed = await verifySendTx(hash)
            if (confirmed) {
                clearSendLock(GNO_CHAIN_ID, ctx.from, attemptId)
                ctx.onSent(hash)
            }
            return confirmed
        },
        onNothingSent: () => clearSendLock(GNO_CHAIN_ID, ctx.from, attemptId),
    }
}
