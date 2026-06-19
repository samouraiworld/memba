/**
 * EcosystemPanel — quick-nav tile grid showing live per-feature counts.
 *
 * Per-panel graceful-degradation contract (same as NetworkPulsePanel):
 *   - NEVER throw during render — degrade to "—" per tile on null/error
 *   - NEVER blank — always show the tile grid structure
 *   - Loading: show skeleton ActionCards
 *   - null count (realm not on this network, or fetch failed): shows "—"
 *
 * Each tile links to the corresponding feature route (network-aware href).
 * A snapshot stamp ("as of #<blockHeight>") signals this is a state snapshot,
 * not a live feed.
 *
 * @module components/home/panels/EcosystemPanel
 */

import { useEcosystemCounts } from "../../../hooks/home/useEcosystemCounts"
import { useNetworkPulse } from "../../../hooks/home/useNetworkPulse"
import { useNetwork } from "../../../hooks/useNetwork"
import { ActionCard } from "../ActionCard"
import "../home.css"

/** Format a count (or null) for display — null -> "—", number -> string. */
function fmtCount(n: number | null): string {
    if (n === null || n === undefined) return "—"
    return String(n)
}

/** Build a network-prefixed href for a feature route. */
function featureHref(networkKey: string, path: string): string {
    return `/${networkKey}/${path}`
}

/**
 * EcosystemPanel — state-board panel for everyone (member + visitor).
 * Shows per-feature counts with deep-link tiles and a block-height stamp.
 */
export function EcosystemPanel() {
    const { tokens, agents, validators, daos, collections, loading } = useEcosystemCounts()
    const { blockHeight } = useNetworkPulse()
    const { networkKey } = useNetwork()

    const stamp = blockHeight ? `#${blockHeight}` : null

    return (
        <div className="ecosystem-panel" data-testid="ecosystem-panel">
            <ActionCard
                accent="teal"
                icon="coin"
                eyebrow="tokens"
                title={fmtCount(tokens)}
                href={featureHref(networkKey, "tokens")}
                actionLabel="View tokens"
                loading={loading}
            />
            <ActionCard
                accent="neutral"
                icon="robot"
                eyebrow="agents"
                title={fmtCount(agents)}
                href={featureHref(networkKey, "marketplace")}
                actionLabel="View agents"
                loading={loading}
            />
            <ActionCard
                accent="neutral"
                icon="shield-check"
                eyebrow="validators"
                title={fmtCount(validators)}
                href={featureHref(networkKey, "validators")}
                actionLabel="View validators"
                loading={loading}
            />
            <ActionCard
                accent="neutral"
                icon="building-community"
                eyebrow="DAOs"
                title={fmtCount(daos)}
                href={featureHref(networkKey, "dao")}
                actionLabel="View DAOs"
                loading={loading}
            />
            <ActionCard
                accent="neutral"
                icon="photo"
                eyebrow="collections"
                title={fmtCount(collections)}
                href={featureHref(networkKey, "nft")}
                actionLabel="View collections"
                meta={stamp ?? undefined}
                loading={loading}
            />
        </div>
    )
}
