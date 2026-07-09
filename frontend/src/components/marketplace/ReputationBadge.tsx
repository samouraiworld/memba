/**
 * ReputationBadge — the shared seller-reputation chip (marketplace-v2 Phase 1.5b).
 *
 * Renders rating / level / verified-review count from an AUTHORITATIVE reputation
 * object (read from the reviews realm keyed by seller address), or a neutral
 * "New seller" when there's no reputation yet. It NEVER fabricates a rating.
 * Used by `MarketCard` and by listing detail pages (e.g. `TokenDetail`).
 *
 * Inside a `.mkt-card` the level tints to the lane accent (`--mkt-accent`); used
 * standalone it falls back to the primary accent.
 *
 * @module components/marketplace/ReputationBadge
 */
import type { CardReputation } from "../../lib/marketplace/types"
import "./ReputationBadge.css"

export interface ReputationBadgeProps {
    reputation: CardReputation | null
    className?: string
}

export function ReputationBadge({ reputation, className }: ReputationBadgeProps) {
    const cls = "rep-badge" + (className ? ` ${className}` : "")
    if (!reputation) {
        return <span className={`${cls} rep-badge--new`}>New seller</span>
    }
    return (
        <span className={cls}>
            <span className="rep-badge__rating">★ {reputation.rating.toFixed(1)}</span>
            <span className="rep-badge__level">{reputation.level}</span>
            <span className="rep-badge__count">({reputation.count})</span>
        </span>
    )
}
