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
import { useBlockTimeSeries } from "../../../hooks/home/useBlockTimeSeries"
import { useChainHealth } from "../../../hooks/home/useChainHealth"
import { formatBlockAge } from "../../../lib/networkStatus"
import "../home.css"

export interface NetworkHealthDoorProps {
    networkKey: string
}

const SPARK_W = 100
const SPARK_H = 24
const SPARK_PAD = 2

/**
 * Map an interval series → `<polyline>` points across an SPARK_W×SPARK_H box.
 * Pure & deterministic (exported-style for the test to count points). Taller =
 * longer block interval. A flat series (max===min) sits on the mid-line. Caller
 * guarantees series.length >= 1; an empty series renders no sparkline upstream.
 */
function sparkPoints(series: number[]): string {
    const max = Math.max(...series)
    const min = Math.min(...series)
    const span = max - min
    const innerW = SPARK_W - SPARK_PAD * 2
    const innerH = SPARK_H - SPARK_PAD * 2
    // One x-step per gap; a single point pins to the left edge.
    const stepX = series.length > 1 ? innerW / (series.length - 1) : 0
    return series
        .map((v, i) => {
            const x = SPARK_PAD + i * stepX
            // Invert y (SVG y grows downward); flat series → mid-line.
            const norm = span > 0 ? (v - min) / span : 0.5
            const y = SPARK_PAD + (1 - norm) * innerH
            return `${Math.round(x * 100) / 100},${Math.round(y * 100) / 100}`
        })
        .join(" ")
}

/**
 * Compact inline sparkline of recent block intervals (R2-H4a). Static (no
 * animation — reduced-motion safe by construction). Token-colored via the
 * accent CSS variable. Decorative: aria-hidden, no nested interactive elements.
 */
function BlockTimeSparkline({ series }: { series: number[] }) {
    return (
        <svg
            className="network-health-door__spark"
            viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
            width={SPARK_W}
            height={SPARK_H}
            preserveAspectRatio="none"
            aria-hidden="true"
            focusable="false"
            data-testid="network-health-sparkline"
        >
            <polyline
                points={sparkPoints(series)}
                fill="none"
                stroke="var(--color-k-accent)"
                strokeWidth={1.5}
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
            />
        </svg>
    )
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
    // Recent block intervals for the sparkline — via the /api/indexer proxy
    // (same path as the activity feed). Empty/unavailable → no sparkline.
    const { series } = useBlockTimeSeries()
    // Chain-liveness: the validator set looks "healthy" even while the chain is
    // halted (no signature data on the home), so consult the shared halt signal
    // and tell the truth instead of a misleading "X / Y healthy".
    const chain = useChainHealth()

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

    // The chain itself is stalled/unreachable: don't show a healthy validator
    // count that contradicts the rest of the page. (P0-A2 page-level consistency.)
    if (chain.degraded) {
        return (
            <Door variant="stat" state="ready" eyebrow="network health" href={validatorsHref}>
                <div className="network-health-door">
                    <span className="network-health-door__status network-health-door__status--down" data-testid="network-health-stalled">
                        {chain.health === "unreachable" ? "unreachable" : "network stalled"}
                    </span>
                    {Number.isFinite(chain.blockAge) && chain.blockAge > 0 && (
                        <span className="network-health-door__pulse">
                            <span className="network-health-door__pulse-item network-health-door__pulse-item--muted">
                                last block {formatBlockAge(chain.blockAge)}
                            </span>
                        </span>
                    )}
                </div>
            </Door>
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
                {/* Real recent block-interval sparkline — omitted when the indexer
                    has no window (honesty: never a flat fabricated line). */}
                {series.length > 0 && <BlockTimeSparkline series={series} />}
            </div>
        </Door>
    )
}
