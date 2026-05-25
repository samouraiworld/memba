/**
 * HubBackendDownBanner — sticky degradation banner for the team hub.
 *
 * Renders when the health probe reports "down" OR when ≥3 card queries
 * are in error state. Shows a cache-age hint (from React Query's
 * persisted localStorage cache) and a one-click retry that invalidates
 * all gnolove queries.
 *
 * @module components/gnolove/teams/HubBackendDownBanner
 */

import { useQueryClient } from "@tanstack/react-query"
import type { BackendHealth } from "../../../hooks/gnolove/useGnoloveBackendHealth"

interface Props {
    health: BackendHealth
    cardErrorCount: number
    dataUpdatedAt: number | undefined
}

function formatCacheAge(updatedAt: number | undefined): string {
    if (!updatedAt) return ""
    const diff = Date.now() - updatedAt
    if (diff < 60_000) return "less than a minute ago"
    const mins = Math.round(diff / 60_000)
    if (mins < 60) return `${mins}m ago`
    const hours = Math.round(mins / 60)
    if (hours < 24) return `${hours}h ago`
    return `${Math.round(hours / 24)}d ago`
}

export function HubBackendDownBanner({ health, cardErrorCount, dataUpdatedAt }: Props) {
    const queryClient = useQueryClient()

    const isDown = health === "down" || cardErrorCount >= 2
    if (!isDown) return null

    const cacheHint = formatCacheAge(dataUpdatedAt)

    return (
        <div className="gl-thub-backend-down-banner" role="alert">
            <p>
                Gnolove backend unreachable.
                {cacheHint && <> Showing cached data from {cacheHint}.</>}
                {!cacheHint && <> Some data may be unavailable.</>}
            </p>
            <button
                className="gl-filter-btn gl-filter-btn--active gl-thub-retry-btn"
                onClick={() => queryClient.invalidateQueries({ queryKey: ["gnolove"] })}
            >
                Retry now
            </button>
        </div>
    )
}
