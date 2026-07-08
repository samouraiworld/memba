/**
 * useMarketFilters — URL-synced marketplace filter state (marketplace-v2 Phase 3.1).
 *
 * One source of truth for search/category/sort/verified across every lane, backed by
 * the URL (shareable, back-button-friendly). Wraps the pure `marketFilters` helpers with
 * `useSearchParams`. Writes are `replace: true` so filtering doesn't spam history; the
 * search input should debounce its calls to `setFilters` (the audit's per-keystroke fix).
 *
 * @module lib/marketplace/useMarketFilters
 */
import { useCallback } from "react"
import { useSearchParams } from "react-router-dom"
import { parseFilters, filtersToParams, DEFAULT_FILTERS, type MarketFilters } from "./marketFilters"

export interface UseMarketFilters {
    filters: MarketFilters
    setFilters: (patch: Partial<MarketFilters>) => void
    clear: () => void
}

export function useMarketFilters(): UseMarketFilters {
    const [params, setParams] = useSearchParams()
    const filters = parseFilters(params)

    const setFilters = useCallback(
        (patch: Partial<MarketFilters>) => {
            setParams((prev) => filtersToParams({ ...parseFilters(prev), ...patch }, prev), { replace: true })
        },
        [setParams],
    )

    const clear = useCallback(() => {
        setParams((prev) => filtersToParams(DEFAULT_FILTERS, prev), { replace: true })
    }, [setParams])

    return { filters, setFilters, clear }
}
