/**
 * NetworkHealthDoor — visitor showcase door for network validator health.
 *
 * variant="stat", eyebrow "network health".
 * Data source: useValidatorHealth (reuses ValidatorsPanel's hook — no new fetch).
 * Note: useNetworkPulse's avgBlockTime is available if desired; currently not
 * shown here to keep the stat door focused on live validator health.
 *
 * State mapping:
 *   - loading: Door skeleton (live RPC call; resolves quickly from snapshot-first path).
 *   - ready (total > 0 and status !== "unknown"):
 *       "{active} / {total}" validators + "Healthy" / "Degraded" / "Down" label.
 *       Link → /${networkKey}/validators.
 *       avgUptime and latestIncident are deliberately omitted — avgUptime is null
 *       on the snapshot path and latestIncident is rare; both are shown in the full
 *       validators page. Honesty: no fabricated metric.
 *   - empty/unknown (total === 0 or status === "unknown"): invitation to view
 *       validators page. Never renders "0 / 0" or "—".
 *
 * Refetch: useValidatorHealth wraps react-query but its interface (the returned
 * object) does not surface a refetch callback. The hook auto-retries via react-query
 * defaults. Documented here: no onRetry wired (no refetch available from the
 * hook's public interface). If a retry button is needed, surface query.refetch
 * from useValidatorHealth and update the interface.
 *
 * @module components/home/doors/NetworkHealthDoor
 */

import { Link } from "react-router-dom"
import { Door } from "../Door"
import { useValidatorHealth } from "../../../hooks/home/useValidatorHealth"
import "../home.css"

export interface NetworkHealthDoorProps {
    networkKey: string
}

function statusLabel(status: "healthy" | "degraded" | "down" | "unknown"): string {
    switch (status) {
        case "healthy": return "healthy"
        case "degraded": return "degraded"
        case "down": return "down"
        case "unknown": return ""
    }
}

export function NetworkHealthDoor({ networkKey }: NetworkHealthDoorProps) {
    const { status, active, total, loading } = useValidatorHealth()

    const validatorsHref = `/${networkKey}/validators`

    if (loading) {
        return (
            <Door
                variant="stat"
                state="loading"
                eyebrow="network health"
            />
        )
    }

    // No real data yet: total=0 or unknown — show invitation, never "0 / 0".
    if (total === 0 || status === "unknown") {
        return (
            <Door
                variant="stat"
                state="empty"
                eyebrow="network health"
                invitation={{ label: "View validators", href: validatorsHref }}
            />
        )
    }

    const label = statusLabel(status)

    return (
        <Door variant="stat" state="ready" eyebrow="network health">
            <div className="network-health-door">
                <span className="network-health-door__count">
                    {active} / {total}
                </span>
                {label && (
                    <span className={`network-health-door__status network-health-door__status--${status}`}>
                        {label}
                    </span>
                )}
                <Link to={validatorsHref} className="network-health-door__link">
                    View validators
                </Link>
            </div>
        </Door>
    )
}
