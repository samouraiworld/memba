/**
 * nftFallbackArt.test.ts — the generated fallback must be deterministic,
 * self-contained, well-formed SVG, and on-brand (teal/black, no broken icon).
 */

import { describe, it, expect } from "vitest"
import { nftFallbackSvg, nftFallbackUri } from "./nftFallbackArt"

describe("nftFallbackArt", () => {
    it("is deterministic: same seed → identical markup", () => {
        expect(nftFallbackSvg("samcrew/testy/0")).toEqual(nftFallbackSvg("samcrew/testy/0"))
    })

    it("is distinct: different seeds → different markup", () => {
        expect(nftFallbackSvg("testy/0")).not.toEqual(nftFallbackSvg("testy/1"))
    })

    it("produces well-formed, sandboxable SVG (no script, has gradient + blocks)", () => {
        const svg = nftFallbackSvg("anything")
        expect(svg.startsWith("<svg")).toBe(true)
        expect(svg.endsWith("</svg>")).toBe(true)
        expect(svg).not.toContain("<script")
        expect(svg).toContain("<linearGradient")
        expect(svg).toContain("<rect")
    })

    it("stays on the teal/black brand (hue in 150–204)", () => {
        // Probe a range of seeds; every gradient hue must land in the teal band.
        for (const seed of ["a", "b", "zzz", "samcrew/x/9", "0", "テスト"]) {
            const hues = [...nftFallbackSvg(seed).matchAll(/hsl\((\d+)/g)].map((m) => Number(m[1]))
            expect(hues.length).toBeGreaterThan(0)
            for (const h of hues) {
                expect(h).toBeGreaterThanOrEqual(150)
                expect(h).toBeLessThanOrEqual(218) // base hue (≤204) + 14 accent shift
            }
        }
    })

    it("never falls back to an empty seed (empty string still renders art)", () => {
        const uri = nftFallbackUri("")
        expect(uri).toMatch(/^data:image\/svg\+xml/)
    })
})
