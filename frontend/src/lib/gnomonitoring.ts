/**
 * Gnomonitoring API client — validator metrics (monikers, uptime, participation).
 *
 * Data source: gnomonitoring service (serves Memba's /validators dashboard).
 * All endpoints are public and require no authentication.
 *
 * Integration pattern:
 *   1. Fetch Tendermint RPC data (voting power, pubkey) — existing validators.ts
 *   2. Fetch monitoring data (moniker, uptime, participation) — this module
 *   3. Merge by address — validators.ts mergeWithMonitoringData()
 *   4. Graceful degradation: if monitoring API unavailable, fall back to hex addresses
 */

import { GNO_CHAIN_ID, GNO_MONITORING_API_URL } from "./config"

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

/** Validator first-seen data from gnomonitoring `/first_seen` endpoint. */
export interface MonitoringFirstSeen {
    addr: string
    moniker: string
    firstSeen: string
}

/** Incident/alert data from gnomonitoring `/latest_incidents` endpoint. */
export interface MonitoringIncident {
    addr: string
    moniker: string
    /** CRITICAL | WARNING | RESOLVED | INFO */
    severity: string
    /** ISO timestamp of the incident */
    timestamp: string
    /** Human-readable incident description */
    details: string
}

/** Missing block data from gnomonitoring `/missing_block` endpoint. */
export interface MonitoringMissingBlock {
    addr: string
    moniker: string
    /** Total missed blocks in the period */
    missedBlocks: number
}

/** Operation time data from gnomonitoring `/operation_time` endpoint. */
export interface MonitoringOperationTime {
    addr: string
    moniker: string
    /** Days since last downtime event (number from API) */
    operationTime: number
    /** ISO date of last down event (from same endpoint) */
    lastDownDate: string | null
    /** ISO date of last up event (from same endpoint) */
    lastUpDate: string | null
}

/** TX contribution data from gnomonitoring `/tx_contribution` endpoint. */
export interface MonitoringTxContrib {
    addr: string
    moniker: string
    /** Transaction contribution rate (0-100) */
    txContrib: number
}

/** Combined monitoring data for a single validator. */
export interface MonitoringValidatorData {
    addr: string
    moniker: string
    participationRate: number
    uptime: number | null
    firstSeen: string | null
    /** Total missed blocks this period (from /missing_block) */
    missedBlocks: number | null
    /** Recent incidents (from /latest_incidents) */
    incidents: MonitoringIncident[]
    /** Days since last downtime (from /operation_time) */
    operationTime: number | null
    /** ISO date of last down event (from /operation_time) */
    lastDownDate: string | null
    /** TX contribution rate (from /tx_contrib) */
    txContrib: number | null
}

// ── Session Cache ────────────────────────────────────────────

const CACHE_KEY = `memba_monitoring_cache:${GNO_CHAIN_ID}`
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

const FETCH_TIMEOUT_MS = 8_000

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
        { period: "current_month", chain: GNO_CHAIN_ID },
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
        { chain: GNO_CHAIN_ID },
        signal,
    )
    if (!data) return null

    const filtered = data.filter((v): v is MonitoringUptime => v !== null)
    setCache(cacheKey, filtered)
    return filtered
}

/**
 * Fetch validator first-seen data (earliest participation date).
 * Returns null on failure — caller should show "—" for start time.
 */
export async function fetchMonitoringFirstSeen(
    signal?: AbortSignal,
): Promise<MonitoringFirstSeen[] | null> {
    const cacheKey = "first_seen"
    const cached = getCached<MonitoringFirstSeen[]>(cacheKey)
    if (cached) return cached

    const data = await monitoringFetch<(MonitoringFirstSeen | null)[]>(
        "/first_seen",
        { chain: GNO_CHAIN_ID },
        signal,
    )
    if (!data) return null

    const filtered = data.filter((v): v is MonitoringFirstSeen => v !== null)
    setCache(cacheKey, filtered)
    return filtered
}

// ── New Endpoints (v2.17.0) ──────────────────────────────────

/**
 * Fetch latest validator incidents (crash/warning/resolved alerts).
 * Returns null on failure — caller should show "—" for incidents.
 */
export async function fetchMonitoringIncidents(
    signal?: AbortSignal,
    period: string = "current_month",
): Promise<MonitoringIncident[] | null> {
    const cacheKey = `incidents_${period}`
    const cached = getCached<MonitoringIncident[]>(cacheKey)
    if (cached) return cached

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = await monitoringFetch<any[]>(
        "/latest_incidents",
        { period, chain: GNO_CHAIN_ID },
        signal,
    )
    if (!data) return null

    const filtered: MonitoringIncident[] = data
        .filter((v): v is NonNullable<typeof v> => v !== null)
        .map(v => ({
            addr: v.addr || v.address || "",
            moniker: v.moniker || "",
            // Backend AlertSummary uses `level`, not `severity`
            severity: v.severity || v.level || v.type || "INFO",
            // Backend AlertSummary uses `sentAt`, not `timestamp`
            timestamp: v.timestamp || v.sentAt || v.sent_at || v.created_at || v.date || "",
            // Backend AlertSummary uses `msg`, not `details`
            details: v.details || v.msg || v.message || v.description || "",
        }))
    setCache(cacheKey, filtered)
    return filtered
}

/**
 * Fetch per-validator missing block counts.
 * Returns null on failure — caller should show "—" for missed blocks.
 */
export async function fetchMonitoringMissingBlocks(
    signal?: AbortSignal,
    period: string = "current_month",
): Promise<MonitoringMissingBlock[] | null> {
    const cacheKey = `missing_blocks_${period}`
    const cached = getCached<MonitoringMissingBlock[]>(cacheKey)
    if (cached) return cached

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = await monitoringFetch<any[]>(
        "/missing_block",
        { period, chain: GNO_CHAIN_ID },
        signal,
    )
    if (!data) return null

    const filtered: MonitoringMissingBlock[] = data
        .filter((v): v is NonNullable<typeof v> => v !== null)
        .map(v => ({
            addr: v.addr || v.address || "",
            moniker: v.moniker || "",
            // Backend MissingBlockMetrics uses `missingBlock` (singular, no underscore)
            missedBlocks: typeof v.missedBlocks === "number" ? v.missedBlocks
                : typeof v.missingBlock === "number" ? v.missingBlock
                : typeof v.missed_blocks === "number" ? v.missed_blocks
                : typeof v.missing_block === "number" ? v.missing_block
                : parseInt(v.missedBlocks || v.missingBlock || v.missed_blocks || v.missing_block || "0", 10),
        }))
    setCache(cacheKey, filtered)
    return filtered
}

/**
 * Fetch per-validator operation time / uptime duration.
 * Returns null on failure — caller should show "—" for operation time.
 */
export async function fetchMonitoringOperationTime(
    signal?: AbortSignal,
): Promise<MonitoringOperationTime[] | null> {
    const cacheKey = "operation_time"
    const cached = getCached<MonitoringOperationTime[]>(cacheKey)
    if (cached) return cached

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = await monitoringFetch<any[]>(
        "/operation_time",
        { chain: GNO_CHAIN_ID },
        signal,
    )
    if (!data) return null

    const filtered: MonitoringOperationTime[] = data
        .filter((v): v is NonNullable<typeof v> => v !== null)
        .map(v => ({
            addr: v.addr || v.address || "",
            moniker: v.moniker || "",
            // Backend OperationTimeMetrics returns operationTime as number (days since last down)
            operationTime: typeof v.operationTime === "number" ? v.operationTime
                : typeof v.operation_time === "number" ? v.operation_time
                : 0,
            // Backend also returns lastDownDate and lastUpDate from same endpoint
            lastDownDate: v.lastDownDate || v.last_down_date || null,
            lastUpDate: v.lastUpDate || v.last_up_date || null,
        }))
    setCache(cacheKey, filtered)
    return filtered
}

// ── Combined Fetch ───────────────────────────────────────────

/**
 * Fetch validator TX contribution rate.
 * Returns null on failure — caller should show "—" for txContrib.
 */
export async function fetchMonitoringTxContribution(
    signal?: AbortSignal,
): Promise<MonitoringTxContrib[] | null> {
    const cacheKey = "tx_contribution"
    const cached = getCached<MonitoringTxContrib[]>(cacheKey)
    if (cached) return cached

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = await monitoringFetch<any[]>(
        "/tx_contrib",
        { period: "current_month", chain: GNO_CHAIN_ID },
        signal,
    )
    if (!data) return null

    const filtered: MonitoringTxContrib[] = data
        .filter((v): v is NonNullable<typeof v> => v !== null)
        .map(v => ({
            addr: v.addr || v.address || "",
            moniker: v.moniker || "",
            // Backend TxContribMetrics uses `txContrib`
            txContrib: typeof v.txContrib === "number" ? v.txContrib
                : typeof v.tx_contrib === "number" ? v.tx_contrib
                : parseFloat(v.txContrib || v.tx_contrib || "0"),
        }))
    setCache(cacheKey, filtered)
    return filtered
}

/**
 * Fetch all monitoring data (7 endpoints) in parallel.
 * Merges by address. Returns a Map for O(1) lookup.
 * Returns empty Map on failure — graceful degradation.
 */
export async function fetchAllMonitoringData(
    signal?: AbortSignal,
): Promise<Map<string, MonitoringValidatorData>> {
    const result = new Map<string, MonitoringValidatorData>()

    const [participation, uptime, firstSeen, incidents, missingBlocks, operationTime, txContrib] = await Promise.all([
        fetchMonitoringParticipation(signal),
        fetchMonitoringUptime(signal),
        fetchMonitoringFirstSeen(signal),
        fetchMonitoringIncidents(signal),
        fetchMonitoringMissingBlocks(signal),
        fetchMonitoringOperationTime(signal),
        fetchMonitoringTxContribution(signal),
    ])

    if (!participation) return result

    // Build map from participation data (has moniker + addr)
    for (const p of participation) {
        result.set(p.addr.toLowerCase(), {
            addr: p.addr,
            moniker: p.moniker,
            participationRate: p.participationRate,
            uptime: null,
            firstSeen: null,
            missedBlocks: null,
            incidents: [],
            operationTime: null,
            lastDownDate: null,
            txContrib: null,
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

    // Merge first-seen data
    if (firstSeen) {
        for (const fs of firstSeen) {
            const existing = result.get(fs.addr.toLowerCase())
            if (existing) {
                existing.firstSeen = fs.firstSeen
            } else {
                result.set(fs.addr.toLowerCase(), {
                    addr: fs.addr,
                    moniker: fs.moniker,
                    participationRate: 0,
                    uptime: null,
                    firstSeen: fs.firstSeen,
                    missedBlocks: null,
                    incidents: [],
                    operationTime: null,
                    lastDownDate: null, // Added lastDownDate
                    txContrib: null,
                })
            }
        }
    }

    // Merge incidents
    if (incidents) {
        for (const inc of incidents) {
            const key = inc.addr.toLowerCase()
            const existing = result.get(key)
            if (existing) {
                existing.incidents.push(inc)
            }
        }
    }

    // Merge missing blocks
    if (missingBlocks) {
        for (const mb of missingBlocks) {
            const existing = result.get(mb.addr.toLowerCase())
            if (existing) {
                existing.missedBlocks = mb.missedBlocks
            }
        }
    }

    // Merge operation time
    if (operationTime) {
        for (const ot of operationTime) {
            const existing = result.get(ot.addr.toLowerCase())
            if (existing) {
                existing.operationTime = ot.operationTime
                existing.lastDownDate = ot.lastDownDate
            }
        }
    }

    // Merge TX contribution
    if (txContrib) {
        for (const tc of txContrib) {
            const existing = result.get(tc.addr.toLowerCase())
            if (existing) {
                existing.txContrib = tc.txContrib
            }
        }
    }

    return result
}
