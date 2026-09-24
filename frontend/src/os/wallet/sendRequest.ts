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
import { doContractBroadcast } from "../../lib/grc20"
import type { SignRequest } from "../sign/signer"
import { buildSendMsg, clearSendLock, formatUgnot, SEND_GAS_WANTED, writeSendLock } from "./send"

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
    onSent: (hash: string) => void
}

/** The shared resolver (#1305), reduced to what the re-check needs. */
async function resolveNameNow(name: string): Promise<string | null> {
    const r = await resolveRecipient(`@${name}`)
    if (r.kind === "address") return r.name ? r.address : null
    return r.kind === "unregistered" ? "" : null
}

export function sendRequest(ctx: SendContext): SignRequest<string> {
    const amount = formatUgnot(ctx.ugnot)
    const msgs = [buildSendMsg(ctx.from, ctx.to, ctx.ugnot)]
    const label = `Send ${amount}`
    const who = ctx.toName ? `@${ctx.toName} · ${ctx.to}` : ctx.to
    return {
        title: "Send",
        summary: `Send ${amount}`,
        sub: ctx.toName ? `to @${ctx.toName} (${ctx.to})` : `to ${ctx.to}`,
        lines: () => [
            ["To", who],
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
            // A name can change owner: the address reviewed is the one paid, but only while the name still points there.
            if (ctx.toName) {
                const now = await (ctx.resolveName ?? resolveNameNow)(ctx.toName)
                if (now === null) throw new Error(`Couldn't confirm @${ctx.toName} just now. Nothing was sent; try again.`)
                if (now === "") throw new Error(`@${ctx.toName} is no longer registered. Nothing was sent.`)
                if (now !== ctx.to) throw new Error(`@${ctx.toName} now points to another address. Nothing was sent; review the send again.`)
            }
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
