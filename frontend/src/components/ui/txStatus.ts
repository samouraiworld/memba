import { ENABLE_NATIVE_GNO_MULTISIG } from "../../lib/config"
import { isNativeMultisig } from "../../lib/nativeMultisig"
import type { Transaction } from "../../gen/memba/v1/memba_pb"

export type BadgeStatus = "pending" | "signing" | "ready" | "complete" | "verified" | "unconfirmed" | "legacy-hash" | "read-only" | "on-hold"

/** Derive badge status from transaction data. */
export function getTxStatus(
    finalHash: string,
    sigCount: number,
    threshold: number,
): BadgeStatus {
    if (finalHash) return "complete"
    if (sigCount >= threshold) return "ready"
    if (sigCount > 0) return "signing"
    return "pending"
}

/** Statuses for a Gno multisig record; a stored hash is not proof of execution. */
export function getMultisigStatus(tx: Transaction, nativeReady = false): BadgeStatus {
    const native = isNativeMultisig(tx.multisigPubkeyJson)
    if (tx.finalHash) return native ? (tx.verified ? "verified" : "unconfirmed") : "legacy-hash"
    if (!native) return "read-only"
    if (!ENABLE_NATIVE_GNO_MULTISIG) return "on-hold"
    if (nativeReady && tx.signatures.filter((s) => s.verified).length >= tx.threshold) return "ready"
    return tx.signatures.length > 0 ? "signing" : "pending"
}
