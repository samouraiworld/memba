/**
 * format.ts — Human-readable formatting helpers for the NFT marketplace.
 */

/**
 * Format ugnot as a human-readable GNOT string.
 * ≥0.01 GNOT → 2dp; smaller → up to 6dp (dropping trailing zeros).
 */
export function formatGnot(ugnot: bigint | number): string {
    const n = typeof ugnot === "bigint" ? Number(ugnot) : ugnot
    const gnot = n / 1_000_000
    if (gnot === 0) return "0 GNOT"
    if (gnot >= 0.01) {
        // 2dp, strip trailing zeros
        return `${gnot.toFixed(2).replace(/\.?0+$/, "")} GNOT`
    }
    // More precision for very small amounts
    return `${gnot.toFixed(6).replace(/\.?0+$/, "")} GNOT`
}

/**
 * Truncate a bech32 address to first 8 + last 4 chars.
 * Returns the original if it's shorter than 14 chars.
 */
export function truncateAddr(addr: string): string {
    if (addr.length <= 14) return addr
    return `${addr.slice(0, 8)}…${addr.slice(-4)}`
}

/**
 * Return a relative time string like "2m ago", "1h ago", "3d ago".
 * ts: ISO 8601 string or unix seconds number.
 */
export function relativeTime(ts: string | number): string {
    const ms = typeof ts === "number"
        ? ts * 1000
        : Date.parse(ts)
    if (isNaN(ms)) return "—"
    const diffMs = Date.now() - ms
    const diffS = Math.floor(diffMs / 1000)
    if (diffS < 60) return `${Math.max(diffS, 1)}s ago`
    const diffM = Math.floor(diffS / 60)
    if (diffM < 60) return `${diffM}m ago`
    const diffH = Math.floor(diffM / 60)
    if (diffH < 24) return `${diffH}h ago`
    const diffD = Math.floor(diffH / 24)
    return `${diffD}d ago`
}
