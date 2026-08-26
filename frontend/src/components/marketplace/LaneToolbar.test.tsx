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

    // The external-sync path was previously an effect and had no coverage, which
    // is how it could have been refactored blind. Both directions are pinned:
    // an external change must reach the input, and a local keystroke must NOT be
    // reverted by the parent still holding the old value mid-debounce.
    it("mirrors an external filters.q change into the input", () => {
        const onChange = vi.fn()
        const { rerender } = render(
            <LaneToolbar filters={{ ...DEFAULT_FILTERS, q: "boat" }} onChange={onChange} />,
        )
        expect(screen.getByRole("searchbox")).toHaveValue("boat")

        // e.g. the Clear button or a back-button navigation upstream.
        rerender(<LaneToolbar filters={{ ...DEFAULT_FILTERS, q: "" }} onChange={onChange} />)
        expect(screen.getByRole("searchbox")).toHaveValue("")

        rerender(<LaneToolbar filters={{ ...DEFAULT_FILTERS, q: "anchor" }} onChange={onChange} />)
        expect(screen.getByRole("searchbox")).toHaveValue("anchor")
    })

    it("does not clobber typing while the parent still holds the old q", () => {
        const onChange = vi.fn()
        const filters = { ...DEFAULT_FILTERS, q: "" }
        const { rerender } = render(<LaneToolbar filters={filters} onChange={onChange} />)

        fireEvent.change(screen.getByRole("searchbox"), { target: { value: "har" } })
        expect(screen.getByRole("searchbox")).toHaveValue("har")

        // A re-render for an unrelated reason, parent's q unchanged: the in-flight
        // keystrokes must survive it.
        rerender(<LaneToolbar filters={filters} onChange={onChange} resultCount={7} />)
        expect(screen.getByRole("searchbox")).toHaveValue("har")
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
