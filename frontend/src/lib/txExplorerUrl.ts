/**
 * txExplorerUrl — where a transaction hash can actually be opened.
 *
 * gnoweb (the per-network `explorerUrl` in `lib/config`) serves realms and
 * users but has NO `/tx/<hash>` route, so a gnoweb-based transaction link has
 * never resolved. gnoscan does index transactions and is chain-aware
 * (`?chainId=…`; its bundle ships `pearl-1`, `gnoland1` and `staging` as the
 * selectable chains — {@link GNOSCAN_CHAIN_IDS}), so that is the target.
 *
 * Wallets disagree on the hash encoding: Adena ≥1.20.5 returns lowercase hex,
 * older Adena and a raw `broadcast_tx_commit` reply return base64 of the same
 * 32 bytes. {@link normalizeTxHashHex} folds both into ONE stable lowercase-hex
 * form (the frontend twin of the backend's `normalizeTxHashHex` in
 * `internal/service/tx_verify.go`), so the displayed hash and the link never
 * depend on which wallet signed.
 *
 * @module lib/txExplorerUrl
 */

/** Chain ids gnoscan's chain selector knows (read from its shipped bundle, 2026-09-07). */
export const GNOSCAN_CHAIN_IDS: readonly string[] = ["pearl-1", "gnoland1", "staging"]

const HEX_64 = /^(0x|0X)?[0-9a-fA-F]{64}$/
// 32 bytes → exactly 44 base64 chars with one pad char.
const B64_32 = /^[A-Za-z0-9+/]{43}=$/

/**
 * Normalize a wallet- or RPC-shaped tx hash to bare lowercase 64-hex.
 * Accepts 64-hex (any case, optional 0x) as is, or base64 of exactly 32 bytes;
 * returns null for any other shape so callers can fall back to plain text.
 */
export function normalizeTxHashHex(hash: string): string | null {
    const h = (hash || "").trim()
    if (HEX_64.test(h)) return h.replace(/^0[xX]/, "").toLowerCase()
    if (!B64_32.test(h)) return null
    let raw: string
    try {
        raw = atob(h)
    } catch {
        return null
    }
    if (raw.length !== 32) return null
    let hex = ""
    for (let i = 0; i < raw.length; i++) hex += raw.charCodeAt(i).toString(16).padStart(2, "0")
    return hex
}

/**
 * gnoscan transaction page for `hash` on `chainId`, or null when either the
 * hash is not a 32-byte tx hash or gnoscan does not index that chain — a
 * caller should then render the hash as text rather than a link that 404s.
 */
export function txExplorerUrl(hash: string, chainId: string): string | null {
    const hex = normalizeTxHashHex(hash)
    if (!hex || !GNOSCAN_CHAIN_IDS.includes(chainId)) return null
    return `https://gnoscan.io/transactions/details?txhash=${hex}&chainId=${encodeURIComponent(chainId)}`
}
