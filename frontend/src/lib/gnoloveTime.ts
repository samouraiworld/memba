const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000

/** Calendar API dates are local day keys, not UTC timestamps. */
export function localDateKey(date: Date): string {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, "0")
    const day = String(date.getDate()).padStart(2, "0")
    return `${year}-${month}-${day}`
}

export function formatRelativeTime(iso: string | null | undefined, nowMs: number): string {
    if (!iso) return "—"
    const ts = new Date(iso).getTime()
    if (Number.isNaN(ts)) return "—"
    const diff = nowMs - ts
    if (diff < 60_000) return "just now"
    const mins = Math.round(diff / 60_000)
    if (mins < 60) return `${mins}m ago`
    const hours = Math.round(mins / 60)
    if (hours < 24) return `${hours}h ago`
    const days = Math.round(hours / 24)
    return `${days}d ago`
}

export function isStale(iso: string | null | undefined, nowMs: number): boolean {
    if (!iso) return false
    const ts = new Date(iso).getTime()
    if (Number.isNaN(ts)) return false
    return nowMs - ts > STALE_THRESHOLD_MS
}
