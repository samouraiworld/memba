/**
 * TierBadge — a small pill showing an address's on-chain reputation tier.
 *
 * The tier name is CANONICAL from the realm (memba_points_v1.TierOf); this component only styles it.
 * Unknown tier names fall back to a neutral pill, so an owner adding a custom band never breaks the UI.
 *
 * @module components/points/TierBadge
 */

import "./points.css"

const KNOWN = ["Bronze", "Silver", "Gold", "Platinum", "Diamond"]

export function TierBadge({ tier, className = "" }: { tier: string; className?: string }) {
    if (!tier) return null
    const key = KNOWN.includes(tier) ? tier.toLowerCase() : "default"
    return (
        <span
            className={`tier-badge tier-badge--${key} ${className}`.trim()}
            data-testid="tier-badge"
            data-tier={tier}
        >
            {tier}
        </span>
    )
}
