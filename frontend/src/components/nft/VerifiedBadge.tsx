/**
 * VerifiedBadge — the team/DAO-curated trust signal for a collection (Phase 1).
 *
 * Informational only (never gates listing/trading). Reflects the on-chain
 * `verified` collection-meta flag read via isCollectionVerified(). Renders
 * nothing when not verified, so callers can drop it inline unconditionally.
 *
 * @module components/nft/VerifiedBadge
 */

interface Props {
    verified: boolean
    /** Compact variant for list rows (icon only). */
    compact?: boolean
}

export function VerifiedBadge({ verified, compact = false }: Props) {
    if (!verified) return null
    return (
        <span
            className="verified-badge"
            role="img"
            aria-label="Verified collection"
            title="Verified — curated by the Memba team against published criteria"
        >
            ✔︎{compact ? "" : " Verified"}
        </span>
    )
}
