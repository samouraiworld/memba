/**
 * relativeTime — render a post's block header time (unix seconds, from the
 * deterministic block_ts the indexer denormalizes) as a compact human string:
 * "just now" · "5m" · "3h" · "2d", then "Jun 6" beyond a week. Returns "" for an
 * unknown (0) timestamp so the caller can fall back to the block height.
 *
 * The date form uses UTC month/day so it is stable regardless of viewer locale
 * (and deterministic under test).
 *
 * @module lib/relativeTime
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

export function relativeTime(tsSeconds: bigint, nowMs: number): string {
    if (tsSeconds <= 0n) return ""

    const tsMs = Number(tsSeconds) * 1000
    const diffS = Math.floor((nowMs - tsMs) / 1000)

    if (diffS < 45) return "just now" // includes small negative (clock skew)
    if (diffS < 3600) return `${Math.floor(diffS / 60)}m`
    if (diffS < 86400) return `${Math.floor(diffS / 3600)}h`
    if (diffS < 7 * 86400) return `${Math.floor(diffS / 86400)}d`

    const d = new Date(tsMs)
    return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`
}
