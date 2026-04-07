/**
 * traction.ts — Ecosystem traction metrics for the landing page.
 *
 * Fetches live metrics from gnolove API and ABCI queries:
 * - DAO count (samcrew namespace via gnoweb)
 * - Contributor count (gnolove API)
 * - Tracked repos (gnolove API)
 *
 * Results cached in sessionStorage with 5-minute TTL.
 */

import { GNOLOVE_API_URL } from "./config"
import { getGnowebUrl, fetchNamespaceRealms } from "./gnoweb"

// ── Types ────────────────────────────────────────────────────

export interface TractionMetrics {
    daoCount: number
    contributorCount: number
    repoCount: number
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
 * Fetch traction metrics from gnolove API.
 * Returns cached results if available (5-min TTL).
 * Best-effort — returns partial data on failure.
 */
export async function fetchTractionMetrics(): Promise<TractionMetrics> {
    const cached = getCached()
    if (cached) return cached

    const metrics: TractionMetrics = {
        daoCount: 0,
        contributorCount: 0,
        repoCount: 0,
        fetchedAt: Date.now(),
    }

    const results = await Promise.allSettled([
        // Contributor count from gnolove stats endpoint (returns { users: [...] })
        fetch(`${GNOLOVE_API_URL}/stats`, {
            signal: AbortSignal.timeout(5000),
        }).then(async r => {
            if (!r.ok) return 0
            const data = await r.json()
            return data?.users?.length ?? 0
        }),

        // Repo count from gnolove
        fetch(`${GNOLOVE_API_URL}/repositories`, {
            signal: AbortSignal.timeout(5000),
        }).then(async r => {
            if (!r.ok) return 0
            const data = await r.json()
            return Array.isArray(data) ? data.length : 0
        }),

        // DAO count from gnoweb namespace (live on-chain query)
        (async () => {
            const networkKey = localStorage.getItem("memba_network") || "test12"
            const gnowebUrl = getGnowebUrl(networkKey)
            if (!gnowebUrl) return 0
            const realms = await fetchNamespaceRealms(gnowebUrl, "samcrew")
            return realms.length
        })(),
    ])

    if (results[0].status === "fulfilled") {
        metrics.contributorCount = results[0].value
    }
    if (results[1].status === "fulfilled") {
        metrics.repoCount = results[1].value
    }
    if (results[2].status === "fulfilled" && results[2].value > 0) {
        metrics.daoCount = results[2].value
    }

    setCache(metrics)
    return metrics
}
