/**
 * Inside Memba OS, Connect 4's wallet calls go through the OS review sheet
 * (os/sign) instead of the classic confirmation dialog. The sheet settles by
 * callback; this turns that back into the promise doContractBroadcast gives.
 */
import { useContext, useMemo } from "react"
import { GNO_CHAIN_ID } from "../../lib/config"
import { NothingSentError, doContractBroadcast, feeForGasWanted, networkGasPrice, type AminoMsg } from "../../lib/grc20"
import { formatSend } from "../../os/sign/decode"
import type { SignRequest } from "../../os/sign/signer"
import { SignerContext, type SignerApi } from "../../os/sign/signerContext"

export type Broadcast = typeof doContractBroadcast
type Guard = void | (() => boolean)
type BeforeSign = () => Guard | Promise<Guard>

/** Named like signedTxBroadcast's, so the game's unknown-outcome handling applies. */
export class OsOutcomeUnknownError extends Error {
    name = "OutcomeUnknownError"
    constructor() { super("Outcome unknown. Check the transaction in the notifications before trying again.") }
}

// The caller's check runs before the sheet's: the sheet marks the wallet as
// opening, so a check that stops after it would read as an unknown outcome.
const both = (os: BeforeSign, caller?: BeforeSign): BeforeSign => async () => {
    const mine = await caller?.()
    const sheet = await os()
    return () => (!sheet || sheet()) && (!mine || mine())
}

function describe(msgs: AminoMsg[], feeUgnot: number | undefined): [string, string][] {
    const rows: [string, string][] = []
    for (const { type, value: v } of msgs) {
        if (type === "/auth.m_create_session") {
            rows.push(["Quick play", `Moves sign in this browser until ${new Date(Number(v.expires_at) * 1000).toLocaleString()}`])
            rows.push(["Budget", `${formatSend(v.spend_limit) ?? "—"} per day, for gas and storage`])
        } else if (type === "/auth.m_revoke_session") {
            rows.push(["Ends", "A Quick play session"])
        } else {
            rows.push(["Move", String(v.func)])
            const stake = formatSend(v.send)
            if (stake) rows.push(["Stake", stake])
            const cap = formatSend(v.max_deposit)
            if (cap) rows.push(["Storage deposit cap", cap])
        }
    }
    if (feeUgnot) rows.push(["Network fee", formatSend(`${feeUgnot}ugnot`)!])
    rows.push(["Network", GNO_CHAIN_ID])
    return rows
}

export function osBroadcast(signer: SignerApi): Broadcast {
    return async (msgs, memo, opts) => {
        // Fixed before review, so the sheet shows the fee that is sent.
        const gasFee = opts?.gasFee ?? (opts?.gasWanted ? feeForGasWanted(opts.gasWanted, await networkGasPrice()) : undefined)
        return new Promise((resolve, reject) => {
            let sent: Awaited<ReturnType<Broadcast>> | null = null
            let failure: unknown = null
            const cancelled = () => new NothingSentError(failure instanceof Error ? failure.message : "Cancelled. Nothing was sent.")
            const req: SignRequest = {
                title: "Connect 4",
                summary: memo,
                label: () => memo,
                lines: () => describe(msgs, gasFee),
                prepare: () => ({ msgs }),
                send: async (_choice, beforeSign) => {
                    try {
                        sent = await doContractBroadcast(msgs, memo, { ...opts, gasFee, beforeSign: both(beforeSign, opts?.beforeSign) })
                        return sent
                    } catch (e) { failure = e; throw e }
                },
                onSettled: (outcome) => {
                    if ((outcome === "confirmed" || outcome === "submitted") && sent) resolve(sent)
                    // "cancelled" is the sheet's verified one: the account was unchanged three blocks later.
                    else reject(outcome === "unknown" ? new OsOutcomeUnknownError() : outcome === "cancelled" ? cancelled() : failure ?? cancelled())
                },
                // The sheet stays open only while nothing was sent, so a dismissal never needs reconciling.
                onDismissed: () => reject(cancelled()),
            }
            if (!signer.sign(req)) reject(new Error("Couldn't open the signing review. Finish the one that's open, then try again."))
        })
    }
}

/** The OS sheet's broadcaster inside Memba OS; undefined on classic pages (their dialog applies). */
export function useWalletBroadcast(): Broadcast | undefined {
    const signer = useContext(SignerContext)
    return useMemo(() => (signer ? osBroadcast(signer) : undefined), [signer])
}
