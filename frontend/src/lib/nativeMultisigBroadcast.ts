import { sha256 } from "@noble/hashes/sha2.js"
import { ENABLE_NATIVE_GNO_MULTISIG, GNO_CHAIN_ID } from "./config"
import { broadcastSignedTx, CheckTxError, OutcomeUnknownError, RealmError } from "./signedTxBroadcast"

export function assertNativeAction(chain: string): void {
    if (!ENABLE_NATIVE_GNO_MULTISIG) throw new Error("Native multisig activation is on hold")
    if (chain !== GNO_CHAIN_ID) throw new Error("Stored transaction chain does not match the selected network")
}

/** The node's reply was lost or unreadable: the transaction may be on chain or not. */
export class NativeOutcomeUnknownError extends Error {
    constructor(readonly expectedHash: string) {
        super(`Native broadcast outcome unknown. Expected transaction hash ${expectedHash}. Press Broadcast again: Memba checks the chain first and sends only if the transaction is not there.`)
        this.name = "NativeOutcomeUnknownError"
    }
}

/** About one gnoland-1 block (~3.4 s): time for a node that is a block behind to catch up. */
export function waitOneBlock(): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, 3_500))
}

/** The hash the chain gives these exact bytes: known before they are sent. */
export function nativeTxHash(bytes: Uint8Array): string {
    return Array.from(sha256(bytes), b => b.toString(16).padStart(2, "0")).join("").toUpperCase()
}

// One transport for native bytes (see signedTxBroadcast: chain check, broadcast_tx_commit,
// hash verification); this keeps the flag gate and this flow's own errors. A JSON-RPC error
// is not a refusal — tm2 answers "request timeout" after the transaction entered the mempool
// and "tx already exists in cache" to a re-send — so it stays an unknown outcome here.
export async function broadcastNativeTransaction(chain: string, bytes: Uint8Array): Promise<string> {
    assertNativeAction(chain)
    if (!bytes.length) throw new Error("Native aggregate is not ready for broadcast")
    try {
        return (await broadcastSignedTx(chain, bytes)).hash
    } catch (e) {
        if (e instanceof CheckTxError || e instanceof RealmError) throw new Error("Native CheckTx or DeliverTx failed; transaction was not marked complete")
        if (e instanceof OutcomeUnknownError && e.detail === "RPC returned a different transaction hash") throw new Error(e.detail)
        if (e instanceof OutcomeUnknownError) throw new NativeOutcomeUnknownError(nativeTxHash(bytes))
        throw e
    }
}
