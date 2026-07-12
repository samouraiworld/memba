import { describe, expect, it } from "vitest"
import { paletteFor, PLATES } from "./palette"

describe("daily ambience plates", () => {
    it("is a pure function of the seed", () => {
        expect(paletteFor("barricade-2026-07-12")).toBe(paletteFor("barricade-2026-07-12"))
    })

    it("rotates across days — a month of seeds hits more than one plate", () => {
        const names = new Set<string>()
        for (let d = 1; d <= 30; d++) {
            const day = String(d).padStart(2, "0")
            names.add(paletteFor(`barricade-2026-07-${day}`).name)
        }
        expect(names.size).toBeGreaterThan(1)
    })

    it("plates carry only AMBIENCE colors — identity/threat coding is not swappable", () => {
        for (const p of PLATES) {
            // Structural: a plate is exactly the ambience surface, nothing else.
            expect(Object.keys(p).sort()).toEqual(["horizon", "name", "stockAlt", "windowGlow"].sort())
            for (const k of ["horizon", "stockAlt", "windowGlow"] as const) {
                expect(p[k]).toMatch(/^#[0-9a-f]{6}$/i)
            }
        }
    })
})
