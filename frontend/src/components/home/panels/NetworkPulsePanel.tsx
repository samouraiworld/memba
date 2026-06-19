/**
 * NetworkPulsePanel — realtime network heartbeat panel for the StateBoard.
 *
 * Per-panel graceful-degradation contract (applies to all home panels):
 *   - NEVER throw during render — degrade to "—" on error or no data
 *   - NEVER blank — always show a card structure (skeleton while loading)
 *   - Loading: show skeleton ActionCards
 *   - Error / no data: show "—" as meta
 *
 * Consumes useNetworkPulse() — reuses the hook created in Task 1.1.
 *
 * @module components/home/panels/NetworkPulsePanel
 */

import { useNetworkPulse } from "../../../hooks/home/useNetworkPulse"
import { ActionCard } from "../ActionCard"
import "../home.css"

function fmt(n: number | undefined | null, decimals = 0): string {
    if (n === undefined || n === null || n === 0) return "—"
    return decimals > 0 ? n.toFixed(decimals) : String(n)
}

/**
 * NetworkPulsePanel — shows block time, validator count, and member count.
 * Renders within StateBoard as the first (eager) panel.
 */
export function NetworkPulsePanel() {
    // Graceful: useNetworkPulse never throws — returns zeros while loading/error
    const { avgBlockTime, totalValidators, memberCount, loading } = useNetworkPulse()

    return (
        <div className="network-pulse-panel" data-testid="network-pulse-panel">
            <ActionCard
                accent="teal"
                icon="clock"
                eyebrow="avg block time"
                title={`${fmt(avgBlockTime, 1)} s`}
                loading={loading}
            />
            <ActionCard
                accent="neutral"
                icon="shield-check"
                eyebrow="validators"
                title={fmt(totalValidators)}
                loading={loading}
            />
            <ActionCard
                accent="neutral"
                icon="users"
                eyebrow="contributors"
                title={fmt(memberCount)}
                loading={loading}
            />
        </div>
    )
}
