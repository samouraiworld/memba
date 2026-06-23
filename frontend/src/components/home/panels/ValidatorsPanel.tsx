/**
 * ValidatorsPanel — network-health highlight panel for the StateBoard.
 *
 * Per-panel graceful-degradation contract (same as NetworkPulsePanel):
 *   - NEVER throw during render — degrade to "—" on error or no data
 *   - NEVER blank — always show a card structure (skeleton while loading)
 *   - Loading: show skeleton ActionCards
 *   - Error / no data: show "—" as meta or title
 *
 * Shows:
 *   - Health status dot + label ("Healthy" / "Degraded" / "Down")
 *   - Active / total validator count
 *   - Avg uptime (if monitoring data available)
 *   - Latest incident (if any)
 *   - CTA -> /:network/validators
 *
 * @module components/home/panels/ValidatorsPanel
 */

import { useValidatorHealth } from "../../../hooks/home/useValidatorHealth"
import { useNetwork } from "../../../hooks/useNetwork"
import { ActionCard } from "../ActionCard"
import "../home.css"

/** Human-readable label for status ("unknown" degrades to "—", never a false "Healthy") */
function statusLabel(status: "healthy" | "degraded" | "down" | "unknown"): string {
    switch (status) {
        case "healthy": return "Healthy"
        case "degraded": return "Degraded"
        case "down": return "Down"
        case "unknown": return "—"
    }
}

/** Format avg uptime as "99.5%" or "—" */
function fmtUptime(uptime: number | null): string {
    if (uptime === null || uptime === undefined) return "—"
    return `${uptime.toFixed(1)}%`
}

/** Format active/total as "14 / 14" or "—" */
function fmtActiveTotal(active: number, total: number): string {
    if (total === 0) return "—"
    return `${active} / ${total}`
}

/**
 * ValidatorsPanel — state-board panel for everyone (member + visitor).
 * Shows network-health status, active/total count, avg uptime, latest incident.
 */
export function ValidatorsPanel() {
    const { status, active, total, avgUptime, latestIncident, loading } = useValidatorHealth()
    const { networkKey } = useNetwork()

    const validatorsHref = `/${networkKey}/validators`
    const activeTotal = fmtActiveTotal(active, total)
    const uptimeLabel = fmtUptime(avgUptime)
    const incidentMeta = latestIncident
        ? `${latestIncident.severity}: ${latestIncident.moniker}`
        : undefined

    return (
        <div className="validators-panel" data-testid="validators-panel">
            {/* Health status tile */}
            <ActionCard
                accent={status === "healthy" ? "teal" : status === "degraded" ? "amber" : status === "down" ? "danger" : "neutral"}
                icon="shield-check"
                eyebrow="network health"
                title={loading ? "—" : `${statusLabel(status)}`}
                meta={loading ? undefined : activeTotal}
                href={validatorsHref}
                actionLabel="View validators"
                loading={loading}
            />
            {/* Avg uptime tile */}
            <ActionCard
                accent="neutral"
                icon="chart-bar"
                eyebrow="avg uptime"
                title={loading ? "—" : uptimeLabel}
                href={validatorsHref}
                actionLabel="View validators"
                loading={loading}
            />
            {/* Latest incident tile — shown only when there is an incident */}
            {!loading && latestIncident && (
                <ActionCard
                    accent="amber"
                    icon="alert-triangle"
                    eyebrow="latest incident"
                    title={latestIncident.severity}
                    meta={incidentMeta}
                    href={validatorsHref}
                    actionLabel="View validators"
                />
            )}
        </div>
    )
}
