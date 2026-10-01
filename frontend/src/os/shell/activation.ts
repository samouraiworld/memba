/**
 * Activating an address: its first transaction, so the chain records its public
 * key (tm2's ante handler sets it for any first transaction a key signs). It
 * sends 1 ugnot from the address to itself: only the network fee is spent, no
 * storage deposit is locked, and nothing is written anywhere else.
 *
 * MEASURED with `.app/simulate` on gnoland-1 (height 475,952, 2026-10-01):
 * 624,320 gas for this send; the wallet send's 2,000,000 limit covers it.
 *
 * @module os/shell/activation
 */
import { assertFeeStillCovers, doContractBroadcast, feeForGasWanted, freshFeeForGasWanted, type AminoMsg, type GasPrice } from "../../lib/grc20"
import type { SignRequest } from "../sign/signer"
import { buildSendMsg, SEND_GAS_WANTED } from "../wallet/send"

/** The amount sent to the address itself: it never leaves the address. */
export const ACTIVATION_SEND_UGNOT = 1n

export function activationCosts(price: GasPrice) {
    return { gasWanted: SEND_GAS_WANTED, feeUgnot: feeForGasWanted(SEND_GAS_WANTED, price) }
}

export function activationMsgs(address: string): AminoMsg[] {
    return [buildSendMsg(address, address, ACTIVATION_SEND_UGNOT)]
}

/**
 * Signed through the OS path: the reviewed message is the one sent. Memba asks Adena for the reviewed
 * fee, re-priced right before Adena opens; Adena may set its own from its gas estimate.
 */
export function activationRequest(address: string, price: GasPrice): SignRequest<string> {
    const msgs = activationMsgs(address)
    const { gasWanted, feeUgnot } = activationCosts(price)
    return {
        title: "Activate", summary: "Activate your address", lines: () => [], label: () => "Activate your address",
        prepare: () => ({ msgs }),
        recheck: () => assertFeeStillCovers(feeUgnot, () => freshFeeForGasWanted(gasWanted)),
        send: (_c, beforeSign) => doContractBroadcast(msgs, "Memba Network Activation", { osActivation: true, gasWanted, gasFee: feeUgnot, beforeSign }),
    }
}
