/**
 * LaneView — the generic lane renderer (marketplace-v2 Phase 7 core).
 *
 * Every lane collapses to this: fetch (cached, validated) → adapt to CardModel →
 * filter/sort via the shared toolbar → render the one grid, with real skeleton /
 * error(retry) / empty states. Replaces the four hand-rolled lane bodies the audit
 * found. A concrete lane is now `<LaneView lane fetchFn toCard categories />`.
 *
 * @module components/marketplace/LaneView
 */
import { useLaneQuery } from "../../lib/marketplace/useLaneQuery"
import { useMarketFilters } from "../../lib/marketplace/useMarketFilters"
import { applyFilters } from "../../lib/marketplace/marketFilters"
import { LaneToolbar } from "./LaneToolbar"
import ListingGrid from "./ListingGrid"
import { EmptyState } from "../ui/EmptyState"
import { SkeletonCard } from "../ui/LoadingSkeleton"
import type { AssetType, CardModel } from "../../lib/marketplace/types"

export interface LaneEmpty {
    icon?: string
    title: string
    body?: string
    action?: { label: string; onClick: () => void }
}

export interface LaneViewProps<T> {
    lane: AssetType
    fetchFn: () => Promise<T[]>
    toCard: (item: T) => CardModel
    categories?: string[]
    enabled?: boolean
    /** Empty-state content when the (unfiltered) lane has no listings. */
    empty?: LaneEmpty
}

const SKELETON_COUNT = 6

export function LaneView<T>({ lane, fetchFn, toCard, categories = [], enabled = true, empty }: LaneViewProps<T>) {
    const { filters, setFilters } = useMarketFilters()
    const { cards, isLoading, isError, refetch } = useLaneQuery(lane, fetchFn, toCard, { enabled })
    const shown = applyFilters(cards, filters)

    return (
        <div className="lane-view">
            <LaneToolbar
                filters={filters}
                onChange={setFilters}
                categories={categories}
                resultCount={isLoading || isError ? undefined : shown.length}
            />

            {isLoading ? (
                <div className="mkt-grid" aria-busy="true" aria-label="Loading listings">
                    {Array.from({ length: SKELETON_COUNT }, (_, i) => <SkeletonCard key={i} />)}
                </div>
            ) : isError ? (
                <EmptyState
                    icon="ti-alert-triangle"
                    title="Couldn't load this lane"
                    body="The on-chain read failed. Please try again."
                    action={{ label: "Retry", onClick: refetch }}
                />
            ) : (
                <ListingGrid
                    items={shown}
                    empty={
                        empty ? (
                            <EmptyState
                                icon={empty.icon}
                                title={empty.title}
                                body={empty.body ?? "Check back soon."}
                                action={empty.action}
                            />
                        ) : undefined
                    }
                />
            )}
        </div>
    )
}
