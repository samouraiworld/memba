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

import * as Sentry from "@sentry/react"
import { GNO_CHAIN_ID, GNO_MONITORING_CHAIN, GNO_MONITORING_API_URL } from "./config"

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

// Keyed by GNO_CHAIN_ID, not GNO_MONITORING_CHAIN, on purpose: this namespaces
// the cache by MEMBA's network identity. Two Memba networks could legitimately
// map to the same monitoring key, and they must not share cached rows.
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

// A 4xx from gnomonitoring means it rejected something about the request
// itself — almost always our configured GNO_MONITORING_CHAIN not matching
// its own (admin-edited, un-versioned) chain registry, per config.ts's
// monitoringChain doc-comment. That's a deterministic misconfiguration, not
// a blip: it will not self-heal, and it broke silently twice in 24h (fixed
// in #989) because every gnomonitoring failure — 4xx, 5xx, timeout — looked
// identical from the outside (graceful degradation to blank names). 5xx and
// network errors stay silent on purpose: those ARE the transient cases this
// path exists to swallow. Warned once per (chain, endpoint, status) per page
// load so a single broken key doesn't spam 7 near-identical signals forever.
const warnedRejections = new Set<string>()

function warnOnRejection(path: string, status: number): void {
    const key = `${GNO_MONITORING_CHAIN}:${path}:${status}`
    if (warnedRejections.has(key)) return
    warnedRejections.add(key)
    Sentry.captureMessage(
        `gnomonitoring rejected chain "${GNO_MONITORING_CHAIN}" on ${path} (HTTP ${status})`,
        { level: "warning", tags: { memba_path: "gnomonitoring", endpoint: path, status: String(status) } },
    )
}

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
        if (!res.ok) {
            if (res.status >= 400 && res.status < 500) warnOnRejection(path, res.status)
            return null
        }
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
        { period: "current_month", chain: GNO_MONITORING_CHAIN },
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
        { chain: GNO_MONITORING_CHAIN },
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
        { chain: GNO_MONITORING_CHAIN },
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
        { period, chain: GNO_MONITORING_CHAIN },
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
        { period, chain: GNO_MONITORING_CHAIN },
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
        { chain: GNO_MONITORING_CHAIN },
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
        { period: "current_month", chain: GNO_MONITORING_CHAIN },
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

// ── Moniker resilience (2026-07-09, VALIDATOR_NAMING_RESILIENCE_PLAN) ─────────
//
// Names are slowly-changing reference data: metrics may degrade, identity must
// not. Three layers keep names on screen when gnomonitoring misbehaves:
//   1. ANY moniker-bearing endpoint seeds the map (not just /Participation —
//      one endpoint failing no longer blanks every name).
//   2. A moniker that is empty, "unknown", or shaped like an address is not a
//      name (isRealMoniker) — the backend's addr-fallback can never reach the UI.
//   3. A last-good localStorage cache (7d TTL) backfills names during outages.

/** True when `m` is an actual human moniker — not empty, not the "unknown"
 * placeholder, not the validator's own address, and not address-shaped. */
export function isRealMoniker(m: string | null | undefined, addr?: string): boolean {
    if (!m) return false
    const t = m.trim()
    if (!t || t.toLowerCase() === "unknown") return false
    if (addr && t.toLowerCase() === addr.toLowerCase()) return false
    if (/^g1[0-9a-z]{10,}$/i.test(t)) return false // bech32-shaped ⇒ an address, not a name
    return true
}

const MONIKER_CACHE_KEY = "memba_validator_monikers_v1"
const MONIKER_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7d — names change rarely

type MonikerCache = Record<string, { m: string; t: number }>

function loadMonikerCache(): MonikerCache {
    try {
        const raw = localStorage.getItem(MONIKER_CACHE_KEY)
        if (!raw) return {}
        const parsed = JSON.parse(raw) as MonikerCache
        const now = Date.now()
        const fresh: MonikerCache = {}
        for (const [k, v] of Object.entries(parsed)) {
            if (v && typeof v.m === "string" && now - v.t < MONIKER_CACHE_TTL_MS) fresh[k] = v
        }
        return fresh
    } catch {
        return {} // storage unavailable / corrupt — cache is best-effort only
    }
}

function saveMonikerCache(cache: MonikerCache): void {
    try {
        localStorage.setItem(MONIKER_CACHE_KEY, JSON.stringify(cache))
    } catch {
        // quota/unavailable — losing the cache only loses the outage fallback
    }
}

/**
 * Fetch all monitoring data (7 endpoints) in parallel.
 * Merges by address. Returns a Map for O(1) lookup.
 * Returns empty Map on failure — graceful degradation.
 *
 * Resilient naming: every endpoint carries (addr, moniker), so ANY of them can
 * seed an entry; address-shaped "monikers" are rejected; a last-good cache
 * backfills names when every endpoint degrades. Metrics still only come from
 * their own endpoint — resilience applies to identity, not numbers.
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

    // Seed-or-get an entry from any (addr, moniker) pair. A later real moniker
    // upgrades an entry seeded with a junk one, never the other way around.
    const ensure = (addr: string, moniker: string): MonitoringValidatorData => {
        const key = addr.toLowerCase()
        let entry = result.get(key)
        if (!entry) {
            entry = {
                addr,
                moniker: isRealMoniker(moniker, addr) ? moniker : "",
                participationRate: 0,
                uptime: null,
                firstSeen: null,
                missedBlocks: null,
                incidents: [],
                operationTime: null,
                lastDownDate: null,
                txContrib: null,
            }
            result.set(key, entry)
        } else if (!isRealMoniker(entry.moniker, entry.addr) && isRealMoniker(moniker, addr)) {
            entry.moniker = moniker
        }
        return entry
    }

    if (participation) {
        for (const p of participation) {
            ensure(p.addr, p.moniker).participationRate = p.participationRate
        }
    }
    if (uptime) {
        for (const u of uptime) {
            ensure(u.addr, u.moniker).uptime = u.uptime
        }
    }
    if (firstSeen) {
        for (const fs of firstSeen) {
            ensure(fs.addr, fs.moniker).firstSeen = fs.firstSeen
        }
    }
    if (incidents) {
        for (const inc of incidents) {
            ensure(inc.addr, inc.moniker).incidents.push(inc)
        }
    }
    if (missingBlocks) {
        for (const mb of missingBlocks) {
            ensure(mb.addr, mb.moniker).missedBlocks = mb.missedBlocks
        }
    }
    if (operationTime) {
        for (const ot of operationTime) {
            const entry = ensure(ot.addr, ot.moniker)
            entry.operationTime = ot.operationTime
            entry.lastDownDate = ot.lastDownDate
        }
    }
    if (txContrib) {
        for (const tc of txContrib) {
            ensure(tc.addr, tc.moniker).txContrib = tc.txContrib
        }
    }

    // Last-good cache: backfill missing names from the previous session, then
    // persist every real name we saw this round.
    const cache = loadMonikerCache()
    let dirty = false
    for (const [key, entry] of result) {
        if (!isRealMoniker(entry.moniker, entry.addr)) {
            const cached = cache[key]
            if (cached && isRealMoniker(cached.m, entry.addr)) entry.moniker = cached.m
        } else if (cache[key]?.m !== entry.moniker) {
            cache[key] = { m: entry.moniker, t: Date.now() }
            dirty = true
        }
    }
    if (dirty) saveMonikerCache(cache)

    return result
}
