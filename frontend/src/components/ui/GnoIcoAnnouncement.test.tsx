import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, act, cleanup } from "@testing-library/react"

// The component self-gates on this flag reader — mock it so tests control the gate.
vi.mock("../../lib/config", () => ({ isIcoAnnouncementEnabled: vi.fn(() => true) }))

import { GnoIcoAnnouncement } from "./GnoIcoAnnouncement"
import { daysUntilSale, saleStatusLabel } from "../../lib/gnoIcoSale"

// Sale opens 2026-07-20 00:00 UTC.
const SALE_START = Date.UTC(2026, 6, 20, 0, 0, 0)

describe("daysUntilSale", () => {
    it("counts whole days before the sale (ceil)", () => {
        expect(daysUntilSale(Date.UTC(2026, 6, 7, 0, 0, 0))).toBe(13)
        // Any time on the 19th still rounds up to 1 day out.
        expect(daysUntilSale(Date.UTC(2026, 6, 19, 12, 0, 0))).toBe(1)
    })
    it("is 0 exactly at open and negative once live", () => {
        expect(daysUntilSale(SALE_START)).toBe(0)
        expect(daysUntilSale(SALE_START + 86_400_000)).toBe(-1)
    })
})

describe("saleStatusLabel", () => {
    it("maps day-count to copy across the window", () => {
        expect(saleStatusLabel(13)).toBe("Opens in 13 days · July 20")
        expect(saleStatusLabel(1)).toBe("Opens tomorrow · July 20")
        expect(saleStatusLabel(0)).toBe("Opening today · July 20")
        // Deliberately non-committal once open — points to the portal, doesn't
        // assert the sale is participatable this instant.
        expect(saleStatusLabel(-2)).toBe("Now open — visit the sale")
    })
})

describe("GnoIcoAnnouncement rendering", () => {
    beforeEach(() => {
        vi.useFakeTimers()
        try { localStorage.clear() } catch { /* ignore */ }
    })
    afterEach(() => {
        cleanup()
        vi.useRealTimers()
    })

    const showAfterDelay = () => act(() => { vi.advanceTimersByTime(1600) })

    it("shows after the delay when enabled and not yet dismissed", () => {
        render(<GnoIcoAnnouncement />)
        expect(screen.queryByRole("dialog")).toBeNull() // not shown immediately
        showAfterDelay()
        expect(screen.getByRole("dialog")).toBeTruthy()
        expect(screen.getByText("The GNOT public sale is coming")).toBeTruthy()
    })

    it("does not stack: suppressing hides it even after it became visible", () => {
        const { rerender } = render(<GnoIcoAnnouncement suppressed={false} />)
        showAfterDelay()
        expect(screen.getByRole("dialog")).toBeTruthy()
        // A higher-priority modal (wizard/activation) goes up → must vanish.
        rerender(<GnoIcoAnnouncement suppressed />)
        expect(screen.queryByRole("dialog")).toBeNull()
    })

    it("never appears when suppressed from the start", () => {
        render(<GnoIcoAnnouncement suppressed />)
        showAfterDelay()
        expect(screen.queryByRole("dialog")).toBeNull()
    })

    it("stays dismissed on a later mount (one-shot per campaign)", () => {
        const first = render(<GnoIcoAnnouncement />)
        showAfterDelay()
        // Dismiss via the "Maybe later" button, then flush the exit timer.
        act(() => { screen.getByText("Maybe later").click() })
        act(() => { vi.advanceTimersByTime(300) })
        expect(screen.queryByRole("dialog")).toBeNull()
        first.unmount()

        // A fresh mount (new session) must not re-show the same campaign.
        render(<GnoIcoAnnouncement />)
        showAfterDelay()
        expect(screen.queryByRole("dialog")).toBeNull()
    })
})
