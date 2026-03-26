/**
 * ValidatorHealthGrid — dense Grafana-style per-validator health summary.
 *
 * Shows all validators with their monitoring metrics:
 * health status, participation %, uptime %, missed blocks, TX contribution.
 *
 * Data source: `fetchAllMonitoringData()` + `computeHealthStatus()`.
 * Uses React.memo() to avoid re-renders on 2s consensus polls.
 */

import { memo } from "react"
import type { ValidatorInfo } from "../../lib/validators"
import { ValidatorHealthStatus } from "../../lib/validatorHealth"
import { healthBadge, missedBlocksColor, formatPct } from "./validatorHealthHelpers"

interface ValidatorHealthGridProps {
    validators: ValidatorInfo[]
    loading: boolean
}

function ValidatorHealthGridInner({ validators, loading }: ValidatorHealthGridProps) {
    if (validators.length === 0 && !loading) return null

    // Network health summary counts
    const healthCounts = {
        healthy: validators.filter(v => v.healthStatus === ValidatorHealthStatus.Healthy).length,
        degraded: validators.filter(v => v.healthStatus === ValidatorHealthStatus.Degraded).length,
        down: validators.filter(v => v.healthStatus === ValidatorHealthStatus.Down).length,
        unknown: validators.filter(v => v.healthStatus === ValidatorHealthStatus.Unknown).length,
    }

    return (
        <div className="hk-card hk-vhg" id="hk-validator-health" style={{ gridColumn: "1 / -1" }}>
            <div className="hk-card__title">
                <span className="hk-card__icon">⬡</span>
                VALIDATOR HEALTH
                <span className="hk-badge hk-badge--peers">{validators.length}</span>
                {loading && <span className="hk-pulse" aria-label="Updating…" />}
            </div>

            {/* Network Health Banner */}
            <div className="vh-banner" role="status" aria-label="Network health summary">
                <span className="vh-banner__item vh-banner__item--healthy">
                    ✅ {healthCounts.healthy}
                </span>
                <span className="vh-banner__item vh-banner__item--degraded">
                    🟡 {healthCounts.degraded}
                </span>
                <span className="vh-banner__item vh-banner__item--down">
                    🔴 {healthCounts.down}
                </span>
                <span className="vh-banner__item vh-banner__item--unknown">
                    ⚪ {healthCounts.unknown}
                </span>
            </div>

            {/* Validator table */}
            <div className="hk-peers__table-wrap">
                <table className="hk-peers__table vh-table" aria-label="Validator health metrics">
                    <thead>
                        <tr>
                            <th>#</th>
                            <th>Validator</th>
                            <th>Health</th>
                            <th>Part. %</th>
                            <th>Uptime %</th>
                            <th>Missed</th>
                            <th>TX Contrib</th>
                            <th>Power %</th>
                        </tr>
                    </thead>
                    <tbody>
                        {validators.map(v => {
                            const badge = healthBadge(v.healthStatus)
                            return (
                                <tr key={v.address} className={
                                    v.healthStatus === ValidatorHealthStatus.Down ? "vh-row--down"
                                    : v.healthStatus === ValidatorHealthStatus.Degraded ? "vh-row--degraded"
                                    : ""
                                }>
                                    <td className="hk-dimmed">{v.rank}</td>
                                    <td className="hk-peers__moniker">
                                        {v.moniker || v.gnoAddr?.slice(0, 12) || v.address.slice(0, 10)}
                                    </td>
                                    <td>
                                        <span className={`vh-badge ${badge.className}`}>
                                            {badge.label}
                                        </span>
                                    </td>
                                    <td className={v.participationRate != null && v.participationRate < 90 ? "hk-warn" : ""}>
                                        {formatPct(v.participationRate)}
                                    </td>
                                    <td className={v.uptimePercent != null && v.uptimePercent < 95 ? "hk-warn" : ""}>
                                        {formatPct(v.uptimePercent)}
                                    </td>
                                    <td className={missedBlocksColor(v.missedBlocks)}>
                                        {v.missedBlocks ?? "—"}
                                    </td>
                                    <td>
                                        {v.txContrib != null ? `${v.txContrib.toFixed(1)}%` : "—"}
                                    </td>
                                    <td className="hk-mono">
                                        {v.powerPercent.toFixed(1)}%
                                    </td>
                                </tr>
                            )
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    )
}

export const ValidatorHealthGrid = memo(ValidatorHealthGridInner)
