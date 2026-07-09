/**
 * LaneToolbar — shared marketplace discovery bar (marketplace-v2 Phase 3.2).
 *
 * Search (debounced) + category chips + sort + verified toggle, driven by the
 * URL-synced `MarketFilters`. One toolbar across every lane replaces the ad-hoc
 * per-lane toolbars the audit found. All controls are labelled for a11y; the search
 * input debounces its writes (the audit's per-keystroke `setSearchParams` fix).
 *
 * @module components/marketplace/LaneToolbar
 */
import { useEffect, useRef, useState } from "react"
import type { MarketFilters, SortKey } from "../../lib/marketplace/marketFilters"
import "./LaneToolbar.css"

const SORT_LABELS: Record<SortKey, string> = {
    trending: "Trending",
    recent: "Recently listed",
    "price-asc": "Price: low to high",
    "price-desc": "Price: high to low",
}

export interface LaneToolbarProps {
    filters: MarketFilters
    onChange: (patch: Partial<MarketFilters>) => void
    /** Category chips to show (in addition to an "All" chip). */
    categories?: string[]
    /** Optional result count shown next to the controls. */
    resultCount?: number
    /** Search debounce in ms (default 250). */
    debounceMs?: number
}

export function LaneToolbar({ filters, onChange, categories = [], resultCount, debounceMs = 250 }: LaneToolbarProps) {
    const [qLocal, setQLocal] = useState(filters.q)
    const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

    // Keep the input in sync when filters change externally (e.g. Clear / back button).
    useEffect(() => setQLocal(filters.q), [filters.q])
    // Clean up any pending debounce on unmount.
    useEffect(() => () => clearTimeout(timer.current), [])

    const onQInput = (value: string) => {
        setQLocal(value)
        clearTimeout(timer.current)
        timer.current = setTimeout(() => onChange({ q: value }), debounceMs)
    }

    const activeCategory = filters.category ?? "All"

    return (
        <div className="lane-toolbar">
            <input
                type="search"
                className="lane-toolbar__search"
                placeholder="Search this lane…"
                aria-label="Search listings"
                value={qLocal}
                onChange={(e) => onQInput(e.target.value)}
            />

            {categories.length > 0 && (
                <div className="lane-toolbar__chips" role="group" aria-label="Filter by category">
                    {["All", ...categories].map((cat) => {
                        const active = activeCategory === cat
                        return (
                            <button
                                key={cat}
                                type="button"
                                className={"lane-toolbar__chip" + (active ? " lane-toolbar__chip--active" : "")}
                                aria-pressed={active}
                                onClick={() => onChange({ category: cat === "All" ? null : cat })}
                            >
                                {cat}
                            </button>
                        )
                    })}
                </div>
            )}

            <div className="lane-toolbar__controls">
                <label className="lane-toolbar__sort">
                    <span className="lane-toolbar__label">Sort</span>
                    <select
                        aria-label="Sort listings"
                        value={filters.sort}
                        onChange={(e) => onChange({ sort: e.target.value as SortKey })}
                    >
                        {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
                            <option key={k} value={k}>{SORT_LABELS[k]}</option>
                        ))}
                    </select>
                </label>

                <label className="lane-toolbar__verified">
                    <input
                        type="checkbox"
                        checked={filters.verifiedOnly}
                        onChange={(e) => onChange({ verifiedOnly: e.target.checked })}
                    />
                    Verified only
                </label>

                {resultCount !== undefined && (
                    <span className="lane-toolbar__count k-text-muted">{resultCount} results</span>
                )}
            </div>
        </div>
    )
}
