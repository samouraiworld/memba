/**
 * traction.ts — contributor count for the home DirectoryDoor.
 *
 * Fetches the contributor count from the gnolove API (it drives the
 * DirectoryDoor member count). Cached in sessionStorage with a 5-minute TTL.
 */

import { GNOLOVE_API_URL } from "./config"

// ── Types ────────────────────────────────────────────────────

export interface TractionMetrics {
    contributorCount: number
    fetchedAt: number
}

// ── Cache ────────────────────────────────────────────────────

const CACHE_KEY = "memba_traction"
const CACHE_TTL = 5 * 60 * 1000

function getCached(): TractionMetrics | null {
    try {
        const raw = sessionStorage.getItem(CACHE_KEY)
        if (!raw) return null
        const entry = JSON.parse(raw) as TractionMetrics
        if (Date.now() - entry.fetchedAt > CACHE_TTL) {
            sessionStorage.removeItem(CACHE_KEY)
            return null
        }
        return entry
    } catch {
        return null
    }
}

function setCache(metrics: TractionMetrics): void {
    try {
        sessionStorage.setItem(CACHE_KEY, JSON.stringify(metrics))
    } catch { /* quota */ }
}

// ── Fetch ────────────────────────────────────────────────────

/**
 * Fetch traction metrics from the gnolove API.
 * Returns cached results if available (5-min TTL).
 * Best-effort — returns contributorCount 0 on failure.
 */
export async function fetchTractionMetrics(): Promise<TractionMetrics> {
    const cached = getCached()
    if (cached) return cached

    const metrics: TractionMetrics = {
        contributorCount: 0,
        fetchedAt: Date.now(),
    }

    // Contributor count from the gnolove stats endpoint (returns { users: [...] })
    try {
        const r = await fetch(`${GNOLOVE_API_URL}/stats`, { signal: AbortSignal.timeout(5000) })
        if (r.ok) {
            const data = await r.json()
            metrics.contributorCount = data?.users?.length ?? 0
        }
    } catch { /* best-effort — leave contributorCount at 0 */ }

    setCache(metrics)
    return metrics
}
