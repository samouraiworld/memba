/**
 * LaneToolbar.test.tsx — shared discovery bar controls (marketplace-v2 Phase 3.2).
 */
import { render, screen, fireEvent, act } from "@testing-library/react"
import { describe, it, expect, vi } from "vitest"
import { LaneToolbar } from "./LaneToolbar"
import { DEFAULT_FILTERS } from "../../lib/marketplace/marketFilters"

describe("LaneToolbar", () => {
    it("selects a category via a chip", () => {
        const onChange = vi.fn()
        render(<LaneToolbar filters={DEFAULT_FILTERS} onChange={onChange} categories={["Art", "PFPs"]} />)
        fireEvent.click(screen.getByRole("button", { name: "PFPs" }))
        expect(onChange).toHaveBeenCalledWith({ category: "PFPs" })
    })

    it("clears the category via the All chip", () => {
        const onChange = vi.fn()
        render(<LaneToolbar filters={{ ...DEFAULT_FILTERS, category: "Art" }} onChange={onChange} categories={["Art"]} />)
        fireEvent.click(screen.getByRole("button", { name: "All" }))
        expect(onChange).toHaveBeenCalledWith({ category: null })
    })

    it("toggles verified-only", () => {
        const onChange = vi.fn()
        render(<LaneToolbar filters={DEFAULT_FILTERS} onChange={onChange} />)
        fireEvent.click(screen.getByLabelText(/verified only/i))
        expect(onChange).toHaveBeenCalledWith({ verifiedOnly: true })
    })

    it("changes sort", () => {
        const onChange = vi.fn()
        render(<LaneToolbar filters={DEFAULT_FILTERS} onChange={onChange} />)
        fireEvent.change(screen.getByLabelText(/sort listings/i), { target: { value: "price-asc" } })
        expect(onChange).toHaveBeenCalledWith({ sort: "price-asc" })
    })

    it("debounces the search input (no per-keystroke writes)", () => {
        vi.useFakeTimers()
        try {
            const onChange = vi.fn()
            render(<LaneToolbar filters={DEFAULT_FILTERS} onChange={onChange} debounceMs={200} />)
            fireEvent.change(screen.getByRole("searchbox"), { target: { value: "lat" } })
            expect(onChange).not.toHaveBeenCalled()
            act(() => vi.advanceTimersByTime(210))
            expect(onChange).toHaveBeenCalledWith({ q: "lat" })
        } finally {
            vi.useRealTimers()
        }
    })
})
