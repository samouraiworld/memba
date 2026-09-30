import { sha256 } from "@noble/hashes/sha2.js"
import { ENABLE_NATIVE_GNO_MULTISIG, GNO_CHAIN_ID, GNO_RPC_URL } from "./config"

function record(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Malformed native RPC response")
    return value as Record<string, unknown>
}
function successfulExecution(value: unknown): boolean {
    const result = record(value)
    // Gno's ABCI embeds ResponseBase (Error, not Cosmos' numeric code).
    const base = record(result.ResponseBase)
    return "Error" in base && base.Error === null
}
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

/** The hash the chain gives these exact bytes: known before they are sent. */
export function nativeTxHash(bytes: Uint8Array): string {
    return Array.from(sha256(bytes), b => b.toString(16).padStart(2, "0")).join("").toUpperCase()
}

// One transport for native bytes; never fall back to a wallet rewriting the
// payload, another network, or hex-encoded JSON masquerading as a transaction.
export async function broadcastNativeTransaction(chain: string, bytes: Uint8Array): Promise<string> {
    assertNativeAction(chain)
    if (!bytes.length) throw new Error("Native aggregate is not ready for broadcast")
    const statusRes = await fetch(`${GNO_RPC_URL}/status`)
    if (!statusRes.ok) throw new Error("Unable to verify RPC chain")
    const status = record(record(await statusRes.json()).result)
    if (record(status.node_info).network !== chain || record(status.sync_info).catching_up !== false) throw new Error("RPC is on a different chain or catching up")
    const expected = nativeTxHash(bytes)
    const uncertain = () => new NativeOutcomeUnknownError(expected)
    // JSON-RPC bodies go to the root; /broadcast_tx_commit is the form/query API.
    let response: Response
    try {
        response = await fetch(GNO_RPC_URL, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", method: "broadcast_tx_commit", params: { tx: btoa(Array.from(bytes, b => String.fromCharCode(b)).join("")) }, id: 1 }),
        })
    } catch { throw uncertain() }
    if (!response.ok) throw uncertain()
    let body: Record<string, unknown>
    try { body = record(await response.json()) } catch { throw uncertain() }
    // A JSON-RPC error is not a refusal: tm2 answers "request timeout" after the transaction entered the mempool,
    // and "tx already exists in cache" to a re-send. A refusal comes back as a failed CheckTx, below.
    if (body.error) throw uncertain()
    let result: Record<string, unknown>
    try { result = record(body.result) } catch { throw uncertain() }
    let checkOk: boolean, deliverOk: boolean
    try {
        checkOk = successfulExecution(result.check_tx)
        deliverOk = successfulExecution(result.deliver_tx)
    } catch { throw uncertain() }
    if (!checkOk || !deliverOk) throw new Error("Native CheckTx or DeliverTx failed; transaction was not marked complete")
    if (!/^[1-9][0-9]*$/.test(String(result.height))) throw uncertain()
    const hash = typeof result.hash === "string" ? result.hash : ""
    if (!hash) throw uncertain()
    let actual: string
    try {
        actual = /^[0-9a-f]{64}$/i.test(hash) ? hash.toUpperCase() : Array.from(atob(hash), c => c.charCodeAt(0).toString(16).padStart(2, "0")).join("").toUpperCase()
    } catch { throw uncertain() }
    if (actual !== expected) throw new Error("RPC returned a different transaction hash")
    return expected
}
