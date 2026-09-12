/**
 * Validator Health Status Engine — composite scoring from multiple signals.
 *
 * Determines a validator's real-time operational status by compositing:
 *   1. gnomonitoring incidents (CRITICAL/WARNING/RESOLVED)
 *   2. Block signature history (missed blocks in recent window)
 *   3. gnomonitoring uptime percentage
 *   4. gnomonitoring participation rate
 *
 * Signal priority (highest wins):
 *   incidents > block sigs > uptime > participation
 *
 * @see https://github.com/samouraiworld/gnomonitoring — backend alert thresholds:
 *   CRITICAL = 30+ missed blocks, WARNING = 5+ missed blocks, RESOLVED = back online
 */

import type { ValidatorInfo } from "./validators"

// ── Health Status Enum ──────────────────────────────────────────

export enum ValidatorHealthStatus {
    /** ✅ Signing, uptime ≥ 99%, no recent incidents */
    Healthy = "healthy",
    /** 🟡 Uptime 90-99%, or WARNING-level incident, or 1-4 consecutive missed */
    Degraded = "degraded",
    /** 🔴 Uptime < 90%, or CRITICAL incident, or 5+ consecutive missed */
    Down = "down",
    /** ⚪ No monitoring data available — RPC-only mode */
    Unknown = "unknown",
}

// ── Health Metadata ─────────────────────────────────────────────

export interface ValidatorHealthMeta {
    /** Computed health status */
    status: ValidatorHealthStatus
    /** Human-readable reason for the status */
    reason: string
    /** Severity of the most recent incident (null = no incidents) */
    latestIncidentSeverity: string | null
    /** Timestamp of the most recent incident (ISO string, null = none) */
    latestIncidentTime: string | null
}

// ── Thresholds (aligned with gnomonitoring Telegram bot) ────────

/** Consecutive missed blocks that trigger CRITICAL status */
const CRITICAL_MISSED_THRESHOLD = 5
/** Consecutive missed blocks that trigger WARNING/degraded status */
const WARNING_MISSED_THRESHOLD = 1
/** Uptime % below which the validator is considered down */
const DOWN_UPTIME_THRESHOLD = 90
/** Uptime % below which the validator is considered degraded */
const DEGRADED_UPTIME_THRESHOLD = 99

/**
 * How long an incident stays evidence about the PRESENT.
 *
 * There used to be no such bound, so one CRITICAL incident pinned a validator to
 * Down indefinitely — however old — until a newer incident happened to arrive.
 * gnomonitoring's public /latest_incidents is capped at ten rows CHAIN-WIDE, so
 * a noisy neighbour can evict the RESOLVED row that would have cleared it, and
 * the stale CRITICAL then stands forever. A status is a claim about now.
 */
const INCIDENT_MAX_AGE_MS = 24 * 60 * 60 * 1000

/**
 * Block samples required before a clean window counts as positive evidence.
 *
 * Three good blocks is not a recovery, it is three blocks. Twenty is the roster
 * window, so in practice this asks for at least half of it.
 */
const MIN_LIVE_SAMPLES = 10

// ── Compute Health Status ───────────────────────────────────────

/**
 * Deterministic, priority-based health scoring.
 *
 * Priority: incidents > block sigs > uptime > participation > fallback.
 * The FIRST matching rule determines the final status.
 */
export function computeHealthStatus(validator: ValidatorInfo): ValidatorHealthMeta {
    // ── Guard: no monitoring data at all → Unknown ──
    const hasMonitoring =
        validator.participationRate != null ||
        validator.uptimePercent != null ||
        (validator.incidents && validator.incidents.length > 0) ||
        validator.missedBlocks != null

    if (!hasMonitoring && validator.lastBlockSignatures.length === 0) {
        return {
            status: ValidatorHealthStatus.Unknown,
            reason: "No monitoring data available",
            latestIncidentSeverity: null,
            latestIncidentTime: null,
        }
    }

    // Direct, first-hand evidence about the present: did this validator sign the
    // blocks we just looked at? Used below to stop a long-window average
    // outranking what the chain is doing right now.
    const sigs = validator.lastBlockSignatures
    const liveClean = sigs.length >= MIN_LIVE_SAMPLES && sigs.every(Boolean)

    // ── 1. Incident check (highest priority) ──
    // Only RECENT incidents describe the present — see INCIDENT_MAX_AGE_MS. An
    // incident with a missing or unparseable timestamp is treated as current:
    // absent evidence is not an alibi.
    const recentIncidents = (validator.incidents ?? []).filter(inc => {
        const t = new Date(inc.timestamp).getTime()
        if (!Number.isFinite(t)) return true
        return Date.now() - t <= INCIDENT_MAX_AGE_MS
    })
    if (recentIncidents.length > 0) {
        // Sort by timestamp descending — most recent first
        const sorted = [...recentIncidents].sort(
            (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        )
        const latest = sorted[0]

        // CRITICAL or WARNING severity that hasn't been resolved → immediate status
        const severity = latest.severity?.toUpperCase() || ""
        if (severity === "CRITICAL") {
            return {
                status: ValidatorHealthStatus.Down,
                reason: `CRITICAL incident: ${latest.details || "validator down"}`,
                latestIncidentSeverity: "CRITICAL",
                latestIncidentTime: latest.timestamp,
            }
        }
        if (severity === "WARNING") {
            return {
                status: ValidatorHealthStatus.Degraded,
                reason: `WARNING: ${latest.details || "missing blocks detected"}`,
                latestIncidentSeverity: "WARNING",
                latestIncidentTime: latest.timestamp,
            }
        }
        // RESOLVED/INFO — don't override, continue checking other signals
    }

    // ── 2. Block signature check ──
    if (validator.lastBlockSignatures.length > 0) {
        const recentSigs = validator.lastBlockSignatures
        // Count consecutive missed blocks from the most recent
        let consecutiveMissed = 0
        for (const signed of recentSigs) {
            if (!signed) consecutiveMissed++
            else break
        }

        if (consecutiveMissed >= CRITICAL_MISSED_THRESHOLD) {
            return {
                status: ValidatorHealthStatus.Down,
                reason: `${consecutiveMissed} consecutive blocks missed`,
                latestIncidentSeverity: null,
                latestIncidentTime: null,
            }
        }
        if (consecutiveMissed >= WARNING_MISSED_THRESHOLD) {
            return {
                status: ValidatorHealthStatus.Degraded,
                reason: `${consecutiveMissed} recent block${consecutiveMissed > 1 ? "s" : ""} missed`,
                latestIncidentSeverity: null,
                latestIncidentTime: null,
            }
        }
    }

    // ── 3. Uptime check ──
    // Uptime is a 30-day average. On a chain days old it spans time before
    // genesis, and after any outage it stays depressed long after the validator
    // is back — which is how a profile came to render "Down" directly above
    // "100/100 PERFECT". Where the average and the live window disagree, the
    // live window wins, and the reason says so rather than leaving the badge
    // unexplainable.
    if (validator.uptimePercent != null) {
        if (validator.uptimePercent < DOWN_UPTIME_THRESHOLD) {
            if (liveClean) {
                return {
                    status: ValidatorHealthStatus.Degraded,
                    reason: `Recovering — signed the last ${sigs.length} blocks, but uptime is ${validator.uptimePercent}% over the reporting window`,
                    latestIncidentSeverity: null,
                    latestIncidentTime: null,
                }
            }
            return {
                status: ValidatorHealthStatus.Down,
                reason: `Uptime ${validator.uptimePercent}% (below ${DOWN_UPTIME_THRESHOLD}%)`,
                latestIncidentSeverity: null,
                latestIncidentTime: null,
            }
        }
        if (validator.uptimePercent < DEGRADED_UPTIME_THRESHOLD) {
            return {
                status: ValidatorHealthStatus.Degraded,
                reason: `Uptime ${validator.uptimePercent}% (below ${DEGRADED_UPTIME_THRESHOLD}%)`,
                latestIncidentSeverity: null,
                latestIncidentTime: null,
            }
        }
    }

    // ── 4. All signals green → Healthy ──
    return {
        status: ValidatorHealthStatus.Healthy,
        reason: "All signals nominal",
        latestIncidentSeverity: null,
        latestIncidentTime: null,
    }
}

// ── Health Summary ──────────────────────────────────────────────

export interface NetworkHealthSummary {
    total: number
    healthy: number
    degraded: number
    down: number
    unknown: number
    /** Network-wide uptime average (null if no data) */
    avgUptime: number | null
    /** Most recent incident across all validators */
    latestIncident: { moniker: string; severity: string; timestamp: string; details: string } | null
}

/**
 * Compute network-wide health summary from validator list.
 */
export function computeNetworkHealth(validators: ValidatorInfo[]): NetworkHealthSummary {
    const summary: NetworkHealthSummary = {
        total: validators.length,
        healthy: 0,
        degraded: 0,
        down: 0,
        unknown: 0,
        avgUptime: null,
        latestIncident: null,
    }

    let uptimeSum = 0
    let uptimeCount = 0
    let latestTime = 0

    for (const v of validators) {
        const health = v.healthStatus || ValidatorHealthStatus.Unknown
        switch (health) {
            case ValidatorHealthStatus.Healthy: summary.healthy++; break
            case ValidatorHealthStatus.Degraded: summary.degraded++; break
            case ValidatorHealthStatus.Down: summary.down++; break
            default: summary.unknown++; break
        }

        if (v.uptimePercent != null) {
            uptimeSum += v.uptimePercent
            uptimeCount++
        }

        // Track latest incident across all validators
        if (v.incidents) {
            for (const inc of v.incidents) {
                const t = new Date(inc.timestamp).getTime()
                if (t > latestTime && !isNaN(t)) {
                    latestTime = t
                    summary.latestIncident = {
                        moniker: v.moniker || v.gnoAddr || v.address,
                        severity: inc.severity,
                        timestamp: inc.timestamp,
                        details: inc.details,
                    }
                }
            }
        }
    }

    summary.avgUptime = uptimeCount > 0
        ? Math.round((uptimeSum / uptimeCount) * 100) / 100
        : null

    return summary
}

// ── Health Badge Helpers ────────────────────────────────────────

/** CSS class suffix for a health status badge. */
export function healthCssClass(status: ValidatorHealthStatus): string {
    switch (status) {
        case ValidatorHealthStatus.Healthy: return "val-health-healthy"
        case ValidatorHealthStatus.Degraded: return "val-health-degraded"
        case ValidatorHealthStatus.Down: return "val-health-down"
        default: return "val-health-unknown"
    }
}

/** Human-readable label for a health status. */
export function healthLabel(status: ValidatorHealthStatus): string {
    switch (status) {
        case ValidatorHealthStatus.Healthy: return "Healthy"
        case ValidatorHealthStatus.Degraded: return "Degraded"
        case ValidatorHealthStatus.Down: return "Down"
        default: return "Unknown"
    }
}

/** Emoji icon for a health status. */
export function healthIcon(status: ValidatorHealthStatus): string {
    switch (status) {
        case ValidatorHealthStatus.Healthy: return "✅"
        case ValidatorHealthStatus.Degraded: return "🟡"
        case ValidatorHealthStatus.Down: return "🔴"
        default: return "⚪"
    }
}
