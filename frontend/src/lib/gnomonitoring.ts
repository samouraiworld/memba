/**
 * Gnomonitoring API client — validator metrics (monikers, uptime, participation).
 *
 * Data source: gnomonitoring service (same backend that powers gnolove.world/validators).
 * All endpoints are public and require no authentication.
 *
 * Integration pattern:
 *   1. Fetch Tendermint RPC data (voting power, pubkey) — existing validators.ts
 *   2. Fetch monitoring data (moniker, uptime, participation) — this module
 *   3. Merge by address — validators.ts mergeWithMonitoringData()
 *   4. Graceful degradation: if monitoring API unavailable, fall back to hex addresses
 */

import { GNO_MONITORING_API_URL } from "./config"

// ── Types ────────────────────────────────────────────────────

/** Validator participation data from gnomonitoring `/Participation` endpoint. */
export interface MonitoringParticipation {
    addr: string
    moniker: string
    participationRate: number
}

/** Validator uptime data from gnomonitoring `/uptime` endpoint. */
export interface MonitoringUptime {
    addr: string
    moniker: string
    uptime: number
}

/** Combined monitoring data for a single validator. */
export interface MonitoringValidatorData {
    addr: string
    moniker: string
    participationRate: number
    uptime: number | null
}

// ── Session Cache ────────────────────────────────────────────

const CACHE_KEY = "memba_monitoring_cache"
const CACHE_TTL_MS = 30_000 // 30s

interface CacheEntry<T> {
    data: T
    timestamp: number
}

function getCached<T>(key: string): T | null {
    try {
        const raw = sessionStorage.getItem(`${CACHE_KEY}:${key}`)
        if (!raw) return null
        const entry: CacheEntry<T> = JSON.parse(raw)
        if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
            sessionStorage.removeItem(`${CACHE_KEY}:${key}`)
            return null
        }
        return entry.data
    } catch {
        return null
    }
}

function setCache<T>(key: string, data: T): void {
    try {
        const entry: CacheEntry<T> = { data, timestamp: Date.now() }
        sessionStorage.setItem(`${CACHE_KEY}:${key}`, JSON.stringify(entry))
    } catch { /* sessionStorage full or unavailable */ }
}

// ── API Fetch Helpers ────────────────────────────────────────

const FETCH_TIMEOUT_MS = 5_000

async function monitoringFetch<T>(
    path: string,
    params?: Record<string, string>,
    signal?: AbortSignal,
): Promise<T | null> {
    if (!GNO_MONITORING_API_URL) return null

    const url = new URL(path, GNO_MONITORING_API_URL)
    if (params) {
        for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

    // Combine external signal with timeout
    const combinedSignal = signal
        ? AbortSignal.any([signal, controller.signal])
        : controller.signal

    try {
        const res = await fetch(url.toString(), {
            signal: combinedSignal,
            headers: { Accept: "application/json" },
        })
        if (!res.ok) return null
        return await res.json() as T
    } catch {
        return null // network error, timeout, or abort — graceful degradation
    } finally {
        clearTimeout(timeout)
    }
}

// ── Public API ───────────────────────────────────────────────

/**
 * Fetch validator participation data (moniker + participation rate).
 * Returns null on failure — caller should fall back to hex-address mode.
 */
export async function fetchMonitoringParticipation(
    signal?: AbortSignal,
): Promise<MonitoringParticipation[] | null> {
    const cacheKey = "participation"
    const cached = getCached<MonitoringParticipation[]>(cacheKey)
    if (cached) return cached

    const data = await monitoringFetch<(MonitoringParticipation | null)[]>(
        "/Participation",
        { period: "current_month" },
        signal,
    )
    if (!data) return null

    const filtered = data.filter((v): v is MonitoringParticipation => v !== null)
    setCache(cacheKey, filtered)
    return filtered
}

/**
 * Fetch validator uptime data.
 * Returns null on failure — caller should show "—" for uptime.
 */
export async function fetchMonitoringUptime(
    signal?: AbortSignal,
): Promise<MonitoringUptime[] | null> {
    const cacheKey = "uptime"
    const cached = getCached<MonitoringUptime[]>(cacheKey)
    if (cached) return cached

    const data = await monitoringFetch<(MonitoringUptime | null)[]>(
        "/uptime",
        undefined,
        signal,
    )
    if (!data) return null

    const filtered = data.filter((v): v is MonitoringUptime => v !== null)
    setCache(cacheKey, filtered)
    return filtered
}

/**
 * Fetch all monitoring data (participation + uptime) in parallel.
 * Merges by address. Returns a Map for O(1) lookup.
 * Returns empty Map on failure — graceful degradation.
 */
export async function fetchAllMonitoringData(
    signal?: AbortSignal,
): Promise<Map<string, MonitoringValidatorData>> {
    const result = new Map<string, MonitoringValidatorData>()

    const [participation, uptime] = await Promise.all([
        fetchMonitoringParticipation(signal),
        fetchMonitoringUptime(signal),
    ])

    if (!participation) return result

    // Build map from participation data (has moniker + addr)
    for (const p of participation) {
        result.set(p.addr.toLowerCase(), {
            addr: p.addr,
            moniker: p.moniker,
            participationRate: p.participationRate,
            uptime: null,
        })
    }

    // Merge uptime data
    if (uptime) {
        for (const u of uptime) {
            const existing = result.get(u.addr.toLowerCase())
            if (existing) {
                existing.uptime = u.uptime
            }
        }
    }

    return result
}
