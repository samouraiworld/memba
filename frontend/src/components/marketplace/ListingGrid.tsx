/**
 * ListingGrid — the ONE marketplace grid (marketplace-v2 Phase 1).
 *
 * Renders a list of `CardModel`s as `<MarketCard>`s in a single responsive grid,
 * with a shared empty treatment. Virtualization (Phase 2) will slot in behind this
 * exact API — callers never change. Consistent grid metric across every lane +
 * CollectionPublic replaces the four bespoke grids the audit found.
 *
 * @module components/marketplace/ListingGrid
 */
import type { ReactNode } from "react"
import MarketCard from "./MarketCard"
import { EmptyState } from "../ui/EmptyState"
import type { CardModel } from "../../lib/marketplace/types"
import "./MarketCard.css"

export interface ListingGridProps {
    items: CardModel[]
    /** Rendered when `items` is empty; defaults to a generic EmptyState. */
    empty?: ReactNode
    /** Override the per-item renderer (defaults to `<MarketCard>`). */
    renderItem?: (model: CardModel) => ReactNode
}

export default function ListingGrid({ items, empty, renderItem }: ListingGridProps) {
    if (items.length === 0) {
        return (
            <>
                {empty ?? (
                    <EmptyState
                        icon="ti-search"
                        title="Nothing here yet"
                        body="No listings match — try a different filter or check back soon."
                    />
                )}
            </>
        )
    }

    return (
        <div className="mkt-grid">
            {items.map((model) =>
                renderItem ? (
                    <div key={model.id}>{renderItem(model)}</div>
                ) : (
                    <MarketCard key={model.id} model={model} />
                ),
            )}
        </div>
    )
}
