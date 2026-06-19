import { describe, it, expect } from "vitest"
import { gnotToUgnot, ugnotToGnot, validateMintPrice, MAX_MINT_PRICE_UGNOT } from "./mintPrice"
import { MIN_MINT_PRICE } from "./launchpad"

describe("mintPrice — conversions", () => {
    it("gnotToUgnot multiplies by 1e6 and rounds", () => {
        expect(gnotToUgnot(1)).toBe(1_000_000)
        expect(gnotToUgnot(0.001)).toBe(1000)
        expect(gnotToUgnot(0.0015)).toBe(1500)
    })
    it("ugnotToGnot divides by 1e6", () => {
        expect(ugnotToGnot(1_000_000)).toBe(1)
        expect(ugnotToGnot(1000)).toBe(0.001)
    })
})

describe("mintPrice — validateMintPrice", () => {
    it("empty or 0 is a valid free mint", () => {
        expect(validateMintPrice("")).toEqual({ ok: true, ugnot: 0 })
        expect(validateMintPrice("0")).toEqual({ ok: true, ugnot: 0 })
    })
    it("accepts a price at or above the 0.001 GNOT minimum", () => {
        expect(validateMintPrice("0.001")).toEqual({ ok: true, ugnot: MIN_MINT_PRICE })
        expect(validateMintPrice("1.5")).toEqual({ ok: true, ugnot: 1_500_000 })
    })
    it("rejects a non-zero price below the minimum (the bug)", () => {
        const r = validateMintPrice("0.0001") // 100 ugnot < 1000
        expect(r.ok).toBe(false)
        expect(r.error).toMatch(/0\.001 GNOT/)
    })
    it("rejects negatives and non-numbers", () => {
        expect(validateMintPrice("-1").ok).toBe(false)
        expect(validateMintPrice("abc").ok).toBe(false)
    })
    it("rejects an absurdly large price above the sanity ceiling", () => {
        const r = validateMintPrice(String(ugnotToGnot(MAX_MINT_PRICE_UGNOT) + 1))
        expect(r.ok).toBe(false)
    })
})
