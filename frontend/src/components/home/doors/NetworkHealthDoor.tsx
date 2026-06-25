/**
 * NetworkHealthDoor — visitor showcase door for network validator health.
 *
 * variant="stat", eyebrow "network health".
 * Data sources (both reuse existing hooks — NO new fetch):
 *   - useValidatorHealth: active/total validators + status (ValidatorsPanel's hook).
 *   - useNetworkPulse: live block height + avg block time (the StatusStrip's pulse;
 *     snapshot-first, so this adds no RPC call).
 *
 * State mapping:
 *   - loading: Door skeleton (live RPC call; resolves quickly from snapshot-first path).
 *   - ready (total > 0 and status !== "unknown"):
 *       "{active} / {total}" validators + "Healthy" / "Degraded" / "Down" label,
 *       plus block height and avg block time when the pulse carries them.
 *       The WHOLE card links → /${networkKey}/validators (Door href).
 *       avgUptime/latestIncident remain omitted (null on the snapshot path; shown
 *       on the full validators page). Block height / avg time are omitted when the
 *       pulse has none (0). Honesty: no fabricated metric.
 *   - empty/unknown (total === 0 or status === "unknown"): invitation to view
 *       validators page. Never renders "0 / 0" or "—".
 *
 * @module components/home/doors/NetworkHealthDoor
 */

import { Door } from "../Door"
import { useValidatorHealth } from "../../../hooks/home/useValidatorHealth"
import { useNetworkPulse } from "../../../hooks/home/useNetworkPulse"
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

/** Format avg block time (seconds) compactly, e.g. 2.4 → "2.4s". */
function formatBlockTime(seconds: number): string {
    // Sub-10s shows one decimal (block times are typically a few seconds);
    // larger values round to whole seconds.
    const v = seconds < 10 ? Math.round(seconds * 10) / 10 : Math.round(seconds)
    return `${v}s`
}

export function NetworkHealthDoor({ networkKey }: NetworkHealthDoorProps) {
    const { status, active, total, loading } = useValidatorHealth()
    // Reuse the StatusStrip's pulse for block height/time — no new RPC fetch.
    const { blockHeight, avgBlockTime } = useNetworkPulse()

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

    // The WHOLE card is the link (href on Door) — no inner footer <Link>, which
    // would be an illegal nested <a> inside the card-link.
    return (
        <Door variant="stat" state="ready" eyebrow="network health" href={validatorsHref}>
            <div className="network-health-door">
                <span className="network-health-door__count">
                    {active} / {total}
                </span>
                {label && (
                    <span className={`network-health-door__status network-health-door__status--${status}`}>
                        {label}
                    </span>
                )}
                {/* Block metrics from the pulse — omitted when absent (honesty). */}
                {(!!blockHeight || avgBlockTime > 0) && (
                    <span className="network-health-door__pulse">
                        {!!blockHeight && (
                            <span className="network-health-door__pulse-item" data-testid="network-health-block-height">
                                block #{blockHeight.toLocaleString()}
                            </span>
                        )}
                        {avgBlockTime > 0 && (
                            <span className="network-health-door__pulse-item network-health-door__pulse-item--muted" data-testid="network-health-block-time">
                                ~{formatBlockTime(avgBlockTime)} / block
                            </span>
                        )}
                    </span>
                )}
            </div>
        </Door>
    )
}
