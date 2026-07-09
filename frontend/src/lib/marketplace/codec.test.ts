/**
 * codec.test.ts — validated realm-read decoding (marketplace-v2 Phase 2.1).
 * The codec NEVER throws into render: it returns a Result and drops malformed rows
 * instead of sinking the whole lane on one bad field (the audit's tokenOtcApi risk).
 */
import { describe, it, expect } from "vitest"
import { decodeOtcCsv } from "./codec"

describe("decodeOtcCsv", () => {
    it("decodes a well-formed CSV into typed listings", () => {
        const raw = '"1|g1seller|FORGE|1500|1200000,2|g1other|AXIS|900|50000"'
        const r = decodeOtcCsv(raw)
        expect(r.ok).toBe(true)
        if (!r.ok) return
        expect(r.value).toHaveLength(2)
        expect(r.value[0]).toEqual({
            id: "1",
            seller: "g1seller",
            symbol: "FORGE",
            expectedUnitPrice: 1500n,
            amountAvailable: 1200000n,
        })
    })

    it("drops a malformed row instead of throwing (partial list beats no list)", () => {
        // Row 2 has a non-numeric price → must be skipped, not throw.
        const raw = "1|g1a|FORGE|1500|1000,2|g1b|AXIS|notanumber|50000,3|g1c|PRISM|10|9"
        const r = decodeOtcCsv(raw)
        expect(r.ok).toBe(true)
        if (!r.ok) return
        expect(r.value.map((l) => l.id)).toEqual(["1", "3"])
    })

    it("returns ok([]) for empty or quote-only input", () => {
        expect(decodeOtcCsv("")).toEqual({ ok: true, value: [] })
        expect(decodeOtcCsv('""')).toEqual({ ok: true, value: [] })
    })

    it("never throws on garbage input", () => {
        expect(() => decodeOtcCsv("|||||")).not.toThrow()
        expect(() => decodeOtcCsv("random text no pipes")).not.toThrow()
        expect(decodeOtcCsv("random text no pipes").ok).toBe(true)
    })
})
