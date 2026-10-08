import { sha256 } from "@noble/hashes/sha2.js"
import { GNO_RPC_URL } from "./config"

export class RealmError extends Error { name = "RealmError" }
export class CheckTxError extends Error { name = "CheckTxError" }
export class OutcomeUnknownError extends Error {
    name = "OutcomeUnknownError"
    constructor(readonly expectedHash: string, readonly detail?: string) {
        super(`${detail ? `${detail}. ` : "Outcome unknown. "}Expected transaction hash ${expectedHash}. Check it on-chain before retrying.`)
    }
}

function record(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Malformed native RPC response")
    return value as Record<string, unknown>
}
// Gno's ABCI embeds ResponseBase (Error, not Cosmos' numeric code). Returns the
// failure message, or null on success.
function failure(value: unknown): string | null {
    const base = record(record(value).ResponseBase)
    if (!("Error" in base)) throw new Error("Malformed native RPC response")
    if (base.Error === null) return null
    const err = base.Error
    if (err && typeof err === "object" && typeof (err as { value?: unknown }).value === "string") return (err as { value: string }).value
    const log = typeof base.Log === "string" ? base.Log : ""
    const lines = log.split("\n").map(l => l.trim()).filter(Boolean)
    // Skip amino error header lines.
    return lines.find(l => !/^(--= Error =--|Data:|Msg Traces:|Stack Trace:)/.test(l)) ?? (log.trim() || "Transaction failed")
}

// One transport for signed bytes; never fall back to a wallet rewriting the
// payload, another network, or hex-encoded JSON masquerading as a transaction.
// Callers gate (feature flags, chain checks) before calling; `beforePost` runs
// after the chain preflight, right before the bytes leave, and throws to stop.
export async function broadcastSignedTx(chain: string, bytes: Uint8Array, beforePost?: () => void): Promise<{ hash: string; height: number }> {
    if (!bytes.length) throw new Error("Nothing to broadcast")
    const statusRes = await fetch(`${GNO_RPC_URL}/status`)
    if (!statusRes.ok) throw new Error("Unable to verify RPC chain")
    const status = record(record(await statusRes.json()).result)
    if (record(status.node_info).network !== chain || record(status.sync_info).catching_up !== false) throw new Error("RPC is on a different chain or catching up")
    const expected = Array.from(sha256(bytes), b => b.toString(16).padStart(2, "0")).join("").toUpperCase()
    const uncertain = (detail?: string) => new OutcomeUnknownError(expected, detail)
    beforePost?.()
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
    if (body.error) throw uncertain("RPC rejected the transaction")
    let result: Record<string, unknown>
    let checkErr: string | null, deliverErr: string | null
    try {
        result = record(body.result)
        checkErr = failure(result.check_tx)
        // A rejected check_tx carries no deliver_tx.
        deliverErr = checkErr === null ? failure(result.deliver_tx) : null
    } catch { throw uncertain() }
    if (checkErr !== null) throw new CheckTxError(checkErr)
    if (deliverErr !== null) throw new RealmError(deliverErr)
    if (!/^[1-9][0-9]*$/.test(String(result.height))) throw uncertain()
    const hash = typeof result.hash === "string" ? result.hash : ""
    if (!hash) throw uncertain()
    let actual: string
    try {
        actual = /^[0-9a-f]{64}$/i.test(hash) ? hash.toUpperCase() : Array.from(atob(hash), c => c.charCodeAt(0).toString(16).padStart(2, "0")).join("").toUpperCase()
    } catch { throw uncertain() }
    if (actual !== expected) throw uncertain("RPC returned a different transaction hash")
    return { hash: expected, height: Number(result.height) }
}
