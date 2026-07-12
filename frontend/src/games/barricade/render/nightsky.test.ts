import { describe, expect, it } from "vitest"
import { buildSkyline } from "./nightsky"

describe("buildSkyline", () => {
    it("returns a stable, non-empty skyline (cached + deterministic)", () => {
        const a = buildSkyline()
        const b = buildSkyline()
        expect(a.length).toBeGreaterThan(3)
        expect(a).toBe(b) // cached → same reference, never rebuilt
        expect(JSON.stringify(a)).toBe(JSON.stringify(b))
    })

    it("lays buildings left-to-right within the unit field", () => {
        let prevX = -1
        for (const b of buildSkyline()) {
            expect(b.x).toBeGreaterThanOrEqual(prevX) // non-decreasing
            expect(b.x).toBeGreaterThanOrEqual(0)
            expect(b.x + b.w).toBeLessThanOrEqual(1.0001)
            expect(b.w).toBeGreaterThan(0)
            expect(b.h).toBeGreaterThan(0)
            expect(b.h).toBeLessThanOrEqual(1)
            for (const wy of b.windows) {
                expect(wy).toBeGreaterThanOrEqual(0)
                expect(wy).toBeLessThanOrEqual(1)
            }
            prevX = b.x
        }
    })
})
