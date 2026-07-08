import { describe, it, expect } from "vitest"
import { daysUntilSale, saleStatusLabel } from "./GnoIcoAnnouncement"

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
        expect(saleStatusLabel(0)).toBe("Opens today")
        expect(saleStatusLabel(-2)).toBe("Live now — participate")
    })
})
