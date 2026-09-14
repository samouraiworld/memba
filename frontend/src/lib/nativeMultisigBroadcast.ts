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

// One transport for native bytes; never fall back to a wallet rewriting the
// payload, another network, or hex-encoded JSON masquerading as a transaction.
export async function broadcastNativeTransaction(chain: string, bytes: Uint8Array): Promise<string> {
    assertNativeAction(chain)
    if (!bytes.length) throw new Error("Native aggregate is not ready for broadcast")
    const statusRes = await fetch(`${GNO_RPC_URL}/status`)
    if (!statusRes.ok) throw new Error("Unable to verify RPC chain")
    const status = record(record(await statusRes.json()).result)
    if (record(status.node_info).network !== chain || record(status.sync_info).catching_up !== false) throw new Error("RPC is on a different chain or catching up")
    // JSON-RPC bodies go to the root; /broadcast_tx_commit is the form/query API.
    const response = await fetch(GNO_RPC_URL, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method: "broadcast_tx_commit", params: { tx: btoa(Array.from(bytes, b => String.fromCharCode(b)).join("")) }, id: 1 }),
    })
    if (!response.ok) throw new Error("Native broadcast failed; check the transaction hash before retrying")
    const body = record(await response.json())
    if (body.error) throw new Error("Native RPC rejected the transaction")
    const result = record(body.result)
    if (!successfulExecution(result.check_tx) || !successfulExecution(result.deliver_tx) || !/^[1-9][0-9]*$/.test(String(result.height))) throw new Error("Native CheckTx or DeliverTx failed; transaction was not marked complete")
    const expected = Array.from(sha256(bytes), b => b.toString(16).padStart(2, "0")).join("").toUpperCase()
    const hash = typeof result.hash === "string" ? result.hash : ""
    const actual = /^[0-9a-f]{64}$/i.test(hash) ? hash.toUpperCase() : Array.from(atob(hash), c => c.charCodeAt(0).toString(16).padStart(2, "0")).join("").toUpperCase()
    if (actual !== expected) throw new Error("RPC returned a different transaction hash")
    return expected
}
