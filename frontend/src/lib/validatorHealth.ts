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

    // ── 1. Incident check (highest priority) ──
    if (validator.incidents && validator.incidents.length > 0) {
        // Sort by timestamp descending — most recent first
        const sorted = [...validator.incidents].sort(
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
    if (validator.uptimePercent != null) {
        if (validator.uptimePercent < DOWN_UPTIME_THRESHOLD) {
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
