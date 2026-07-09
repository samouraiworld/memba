/**
 * marketFilters.ts — pure filter/sort logic + URL (de)serialization (marketplace-v2
 * Phase 3.1). Kept router-free so it's trivially testable; `useMarketFilters` wraps it
 * with `useSearchParams`. `applyFilters` is the HONEST search the audit demanded — it
 * actually filters the lane's items (title + seller + category), not names-only-silently.
 *
 * @module lib/marketplace/marketFilters
 */
import type { CardModel } from "./types"

export type SortKey = "trending" | "recent" | "price-asc" | "price-desc"

export interface MarketFilters {
    q: string
    category: string | null
    sort: SortKey
    verifiedOnly: boolean
}

export const DEFAULT_FILTERS: MarketFilters = {
    q: "",
    category: null,
    sort: "trending",
    verifiedOnly: false,
}

const SORTS: SortKey[] = ["trending", "recent", "price-asc", "price-desc"]

/** Filter then sort a card list. Pure; stable for trending/recent (source order). */
export function applyFilters(cards: CardModel[], f: MarketFilters): CardModel[] {
    const q = f.q.trim().toLowerCase()
    const filtered = cards.filter((c) => {
        if (f.verifiedOnly && !c.verified) return false
        if (f.category && c.category !== f.category) return false
        if (q) {
            const hay = `${c.title} ${c.seller.handle} ${c.category ?? ""}`.toLowerCase()
            if (!hay.includes(q)) return false
        }
        return true
    })
    switch (f.sort) {
        case "price-asc":
            return [...filtered].sort((a, b) => (a.priceValue ?? Infinity) - (b.priceValue ?? Infinity))
        case "price-desc":
            return [...filtered].sort((a, b) => (b.priceValue ?? -Infinity) - (a.priceValue ?? -Infinity))
        default:
            // trending / recent: keep source order — real ranking comes from the data layer.
            return filtered
    }
}

/** Read filters from URL search params (defaults for missing/invalid). */
export function parseFilters(p: URLSearchParams): MarketFilters {
    const sort = p.get("sort")
    return {
        q: p.get("q") ?? "",
        category: p.get("category") || null,
        sort: SORTS.includes(sort as SortKey) ? (sort as SortKey) : "trending",
        verifiedOnly: p.get("verified") === "1",
    }
}

/** Serialize filters into search params (omitting defaults; preserving `base` params). */
export function filtersToParams(f: MarketFilters, base?: URLSearchParams): URLSearchParams {
    const p = new URLSearchParams(base)
    if (f.q) p.set("q", f.q)
    else p.delete("q")
    if (f.category) p.set("category", f.category)
    else p.delete("category")
    if (f.sort !== "trending") p.set("sort", f.sort)
    else p.delete("sort")
    if (f.verifiedOnly) p.set("verified", "1")
    else p.delete("verified")
    return p
}
