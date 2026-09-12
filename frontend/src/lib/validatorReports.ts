/**
 * gnomonitoring's scored validator report — `GET /api/reports/validators`.
 *
 * One unauthenticated call returns, per validator and per reporting window, a
 * 0-100 score, a tier, sign rate, proposer reliability, flap-collapsed incident
 * counts and downtime. It replaces most of what the roster assembles from seven
 * separate endpoints and adds what it has no source for at all. The same
 * endpoint is already consumed in production by katana and gno-score-validator,
 * so the contract is proven rather than assumed.
 *
 * Scoring formula: gnomonitoring `backend/internal/score/score.go:83-174`.
 * Tiers: Excellent >= 85, Good >= 60, Watch >= 30, else Critical.
 *
 * ⚠️ THE FAILURE MODE THIS MODULE EXISTS TO CONTAIN.
 *
 * gnomonitoring computes a report for every roster member, including ones it has
 * no data for, and `score.Compute(Inputs{})` on zero-valued inputs returns
 * score 0 — which `tierFor` maps to "Critical". That is deliberate upstream
 * (`validator_report.go:266`, `api_report.go:122`), and it means a monitoring
 * outage, an indexer stall, and a validator that joined an hour ago all arrive
 * looking exactly like sustained total failure. Worse, when voting-power data is
 * unavailable the upstream roster filter is skipped entirely, so EVERY
 * historical address is emitted at score 0.
 *
 * Rendering that verbatim would tell users the whole validator set is Critical
 * every time our own monitoring hiccups. `hasData` is the guard: a window with
 * neither signing evidence nor failure evidence is an absence of information,
 * not a verdict of zero. Callers must check it before showing a score, a tier or
 * anything derived from them.
 */

import { GNO_MONITORING_API_URL, GNO_MONITORING_CHAIN } from "./config"

const FETCH_TIMEOUT_MS = 8_000
const CACHE_TTL_MS = 30_000

/** Reporting windows gnomonitoring returns. Note these are the ONLY valid
 *  values — `24h`/`7d`/`30d` are rejected upstream with HTTP 500. */
export const REPORT_WINDOWS = ["last_24h", "current_week", "current_month", "current_year"] as const
export type ReportWindow = (typeof REPORT_WINDOWS)[number]

export interface ValidatorReportPeriod {
    /** 0-100 composite. Meaningless unless `hasData`. */
    score: number
    /** Excellent | Good | Watch | Critical. Meaningless unless `hasData`. */
    tier: string
    signRate: number
    /** null when the validator's expected proposer share was too small to judge. */
    proposerReliability: number | null
    votingPower: number
    criticalCount: number
    warningCount: number
    /** Incidents with consecutive WARNING/CRITICAL rows collapsed — an
     *  anti-flap count, not a raw alert tally. */
    incidentCount: number
    incidentRatePerWeek: number
    downtimeBlocks: number
    missedBlocks: number
    /** False when the window carries no evidence in either direction. See the
     *  module docstring: score 0 is indistinguishable from "never measured". */
    hasData: boolean
}

export interface ValidatorReport {
    addr: string
    moniker: string
    daysSinceLastAlert: number | null
    periods: Record<ReportWindow, ValidatorReportPeriod | null>
    /** True when ANY window carries evidence. */
    hasData: boolean
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function num(v: any, fallback = 0): number {
    const n = typeof v === "number" ? v : Number(v)
    return Number.isFinite(n) ? n : fallback
}

/**
 * Does this window carry evidence in EITHER direction?
 *
 * Positive evidence (the validator signed something) or negative evidence (it
 * missed blocks, was down, or raised incidents) both count. Only the total
 * absence of both is "no data" — which is exactly the zero-valued report
 * gnomonitoring synthesises for a validator it has never seen.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function windowHasEvidence(raw: any): boolean {
    return num(raw?.sign_rate) > 0
        || num(raw?.missed_blocks) > 0
        || num(raw?.downtime_blocks) > 0
        || num(raw?.incident_count) > 0
        || num(raw?.critical_count) > 0
        || num(raw?.warning_count) > 0
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parsePeriod(raw: any): ValidatorReportPeriod | null {
    if (!raw || typeof raw !== "object") return null
    return {
        score: num(raw.score),
        tier: typeof raw.tier === "string" ? raw.tier : "Unknown",
        signRate: num(raw.sign_rate),
        proposerReliability: raw.proposer_reliability == null ? null : num(raw.proposer_reliability),
        votingPower: num(raw.voting_power),
        criticalCount: num(raw.critical_count),
        warningCount: num(raw.warning_count),
        incidentCount: num(raw.incident_count),
        incidentRatePerWeek: num(raw.incident_rate_per_week),
        downtimeBlocks: num(raw.downtime_blocks),
        missedBlocks: num(raw.missed_blocks),
        hasData: windowHasEvidence(raw),
    }
}

let cache: { at: number; value: Map<string, ValidatorReport> | null } | null = null

/** Test seam — module-level cache would otherwise leak between cases. */
export function __resetReportCacheForTests(): void {
    cache = null
}

/**
 * Fetch every validator's scored report for the active monitoring chain.
 *
 * Returns null — deliberately NOT an empty map — when the endpoint cannot be
 * reached. An empty map means "this chain has no validators"; null means "we
 * could not ask". Collapsing the two is how an outage renders as an empty
 * network.
 */
export async function fetchValidatorReports(
    signal?: AbortSignal,
): Promise<Map<string, ValidatorReport> | null> {
    if (!GNO_MONITORING_API_URL) return null
    if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.value

    const url = new URL("/api/reports/validators", GNO_MONITORING_API_URL)
    url.searchParams.set("chain", GNO_MONITORING_CHAIN)

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal

    try {
        const res = await fetch(url.toString(), {
            signal: combined,
            headers: { Accept: "application/json" },
        })
        if (!res.ok) return null

        const body = await res.json()
        // An unknown chain answers 400 with a body; anything non-array is a
        // contract violation, not an empty roster.
        if (!Array.isArray(body)) return null

        const map = new Map<string, ValidatorReport>()
        for (const raw of body) {
            const addr = typeof raw?.addr === "string" ? raw.addr : ""
            if (!addr) continue
            const periods = {} as Record<ReportWindow, ValidatorReportPeriod | null>
            for (const w of REPORT_WINDOWS) periods[w] = parsePeriod(raw?.periods?.[w])
            map.set(addr.toLowerCase(), {
                addr,
                moniker: typeof raw?.moniker === "string" ? raw.moniker : "",
                daysSinceLastAlert: raw?.days_since_last_alert == null
                    ? null
                    : num(raw.days_since_last_alert),
                periods,
                hasData: REPORT_WINDOWS.some((w) => periods[w]?.hasData === true),
            })
        }
        cache = { at: Date.now(), value: map }
        return map
    } catch {
        return null // network error, timeout, or abort — graceful degradation
    } finally {
        clearTimeout(timeout)
    }
}
