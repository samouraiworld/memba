/**
 * Activating an address: its first transaction, so the chain records its public
 * key (tm2's ante handler sets it for any first transaction a key signs). It
 * sends 1 ugnot from the address to itself: only the network fee is spent, no
 * storage deposit is locked, and nothing is written to any realm or profile. The classic
 * activation dialog and Memba OS send this same message.
 *
 * MEASURED with `.app/simulate` on gnoland-1 (height 475,952, 2026-10-01):
 * 624,320 gas for this send; a 2,000,000 limit covers it.
 *
 * @module lib/activation
 */
import { chainPublicKey } from "./account"
import { feeForGasWanted, type AminoMsg, type GasPrice } from "./grc20"

export const ACTIVATION_MEMO = "Memba Network Activation"

/** The amount sent to the address itself: it never leaves the address. */
export const ACTIVATION_SEND_UGNOT = 1n

const ACTIVATION_GAS_WANTED = 2_000_000

export function activationCosts(price: GasPrice) {
    return { gasWanted: ACTIVATION_GAS_WANTED, feeUgnot: feeForGasWanted(ACTIVATION_GAS_WANTED, price) }
}

export function activationMsgs(address: string): AminoMsg[] {
    return [{ type: "/bank.MsgSend", value: { from_address: address, to_address: address, amount: `${ACTIVATION_SEND_UGNOT}ugnot` } }]
}

/** How long Memba waits for the chain to show the activated key: normally one or two blocks (3.4 s each). */
export const ACTIVATION_VISIBLE_WITHIN_MS = 30_000
const KEY_READ_EVERY_MS = 2_000

/** Said when the chain did not show the key in time. */
export const ACTIVATION_NOT_SEEN = "Your activation was sent, but the network doesn't show it yet."

/**
 * Adena answers once the activation is broadcast, before its block, and a login
 * signature needs the key on chain. True once the chain shows a key for
 * `address`; false when it does not within ACTIVATION_VISIBLE_WITHIN_MS, or once
 * `stop` fires. A read that fails counts as "not yet".
 */
export async function activationOnChain(address: string, stop?: AbortSignal): Promise<boolean> {
    const deadline = Date.now() + ACTIVATION_VISIBLE_WITHIN_MS
    for (;;) {
        if (await chainPublicKey(address).then(Boolean, () => false)) return true
        if (stop?.aborted || Date.now() + KEY_READ_EVERY_MS > deadline) return false
        await new Promise((resolve) => setTimeout(resolve, KEY_READ_EVERY_MS))
        if (stop?.aborted) return false
    }
}
