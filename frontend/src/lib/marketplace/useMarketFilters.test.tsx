/**
 * useMarketFilters.test.tsx — URL <-> filter state sync (marketplace-v2 Phase 3.1).
 */
import type { ReactNode } from "react"
import { renderHook, act } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { describe, it, expect } from "vitest"
import { useMarketFilters } from "./useMarketFilters"

const wrapAt = (initial: string) =>
    ({ children }: { children: ReactNode }) => <MemoryRouter initialEntries={[initial]}>{children}</MemoryRouter>

describe("useMarketFilters", () => {
    it("reads filters from the URL", () => {
        const { result } = renderHook(() => useMarketFilters(), {
            wrapper: wrapAt("/m?q=gno&category=Art&verified=1"),
        })
        expect(result.current.filters).toEqual({ q: "gno", category: "Art", sort: "trending", verifiedOnly: true })
    })

    it("writes a filter patch back to the URL", () => {
        const { result } = renderHook(() => useMarketFilters(), { wrapper: wrapAt("/m") })
        act(() => result.current.setFilters({ q: "lattice", sort: "price-asc" }))
        expect(result.current.filters.q).toBe("lattice")
        expect(result.current.filters.sort).toBe("price-asc")
    })

    it("merges patches without dropping existing filters", () => {
        const { result } = renderHook(() => useMarketFilters(), { wrapper: wrapAt("/m?q=x") })
        act(() => result.current.setFilters({ verifiedOnly: true }))
        expect(result.current.filters.q).toBe("x")
        expect(result.current.filters.verifiedOnly).toBe(true)
    })

    it("clear resets all filters to defaults", () => {
        const { result } = renderHook(() => useMarketFilters(), { wrapper: wrapAt("/m?q=x&verified=1&sort=price-asc") })
        act(() => result.current.clear())
        expect(result.current.filters).toEqual({ q: "", category: null, sort: "trending", verifiedOnly: false })
    })
})
