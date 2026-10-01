/**
 * One MsgCall to a Launchpad realm as a signer request: the review lines with
 * its storage deposit and network fee, a recheck against the chain right
 * before Adena opens, and verification by the transaction's own result.
 *
 * @module os/apps/tokens/callRequest
 */
import { GNO_CHAIN_ID } from "../../../lib/config"
import { depositCapUgnot, formatUgnotExact } from "../../../lib/dao/v2Budget"
import { assertFeeStillCovers, doContractBroadcast, feeForGasWanted, freshFeeForGasWanted, type AminoMsg, type GasPrice } from "../../../lib/grc20"
import type { SignRequest } from "../../sign/signer"
import { verifySendTx } from "../../wallet/sendRequest"

export interface LaunchCall {
    caller: string
    pkgPath: string
    func: string
    args: string[]
    /** Coins attached, as "<amount>ugnot", or "". */
    send: string
    /** About twice what the call measured on a committed node. */
    gasWanted: number
    /** The most bytes the call can add; the deposit cap is twice this. */
    bytes: number
    title: string
    summary: string
    /** What the call names, e.g. the token. */
    subject: string
    facts: [string, string][]
    note: string
    /** Throws a sentence for the member when the chain no longer allows the call. */
    recheck: () => Promise<void>
    gasPrice: GasPrice
    onSettled: (outcome: string) => void
}

export function launchCallRequest(call: LaunchCall): SignRequest {
    const gasFee = feeForGasWanted(call.gasWanted, call.gasPrice)
    const depositCap = depositCapUgnot(call.bytes)
    const msg: AminoMsg = {
        type: "vm/MsgCall",
        value: { caller: call.caller, send: call.send, pkg_path: call.pkgPath, func: call.func, args: call.args, max_deposit: `${depositCap}ugnot` },
    }
    return {
        title: call.title, summary: call.summary, sub: `${call.subject} on ${GNO_CHAIN_ID}`,
        lines: () => [...call.facts, ["Storage deposit", `Up to ${formatUgnotExact(depositCap)}`], ["Network fee", formatUgnotExact(gasFee)]],
        note: call.note,
        label: () => call.summary,
        prepare: () => ({ msgs: [msg] }),
        recheck: async () => {
            await call.recheck()
            await assertFeeStillCovers(gasFee, () => freshFeeForGasWanted(call.gasWanted))
        },
        send: (_choice, beforeSign) => doContractBroadcast([msg], call.summary, { gasWanted: call.gasWanted, gasFee, beforeSign }),
        verify: (_choice, hash) => verifySendTx(hash),
        onSettled: outcome => call.onSettled(outcome),
    }
}
