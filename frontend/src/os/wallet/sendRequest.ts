/**
 * A GNOT send as a signing request (D15, D17, D37): the Memba review with the
 * tiered address check, the exact `/bank.MsgSend`, a lock saved before the
 * wallet opens (an unknown outcome holds the Send window until checked), and
 * no automatic retry: a retried send could pay twice.
 *
 * @module os/wallet/sendRequest
 */
import { GNO_CHAIN_ID } from "../../lib/config"
import { doContractBroadcast } from "../../lib/grc20"
import type { SignRequest } from "../sign/signer"
import { buildSendMsg, clearSendLock, formatUgnot, SEND_GAS_WANTED, writeSendLock } from "./send"

export interface SendContext {
    from: string
    to: string
    ugnot: bigint
    memo: string
    feeUgnot: bigint
    tiers: string[]
    /** The wallet's account right now, asked of the wallet itself; the send stops if it changed since the review. */
    currentWallet: () => Promise<string>
    onSent: (hash: string) => void
}

export function sendRequest(ctx: SendContext): SignRequest<string> {
    const amount = formatUgnot(ctx.ugnot)
    const msgs = [buildSendMsg(ctx.from, ctx.to, ctx.ugnot)]
    const label = `Send ${amount}`
    return {
        title: "Send",
        summary: `Send ${amount}`,
        sub: `to ${ctx.to}`,
        lines: () => [
            ["To", ctx.to],
            ["Amount", amount],
            ["Network", GNO_CHAIN_ID],
            ["Network fee", `up to ${formatUgnot(ctx.feeUgnot)}`],
            ...(ctx.memo ? [["Memo", ctx.memo] as [string, string]] : []),
        ],
        warns: ctx.tiers.includes("new address") ? ["You have never sent to this address. Transfers can't be reversed."] : [],
        acks: ctx.tiers.length ? [`I checked the full address with the recipient${ctx.tiers.includes("100 GNOT or more") ? ", and the amount" : ""}.`] : [],
        note: "Adena shows this as a Transfer.",
        label: () => label,
        prepare: () => ({ msgs }),
        recheck: async () => {
            if ((await ctx.currentWallet()) !== ctx.from) throw new Error("Your wallet changed since the review. Review the send again.")
        },
        send: async (_c, beforeSign) => {
            // Durable before the wallet opens: a lost response must not look like "nothing happened".
            writeSendLock(GNO_CHAIN_ID, ctx.from, { label, hash: "", at: Date.now() })
            const res = await doContractBroadcast(msgs, ctx.memo, { gasWanted: SEND_GAS_WANTED, retry: false, beforeSign })
            clearSendLock(GNO_CHAIN_ID, ctx.from)
            ctx.onSent(res.hash)
            return res
        },
        onNothingSent: () => clearSendLock(GNO_CHAIN_ID, ctx.from),
    }
}
