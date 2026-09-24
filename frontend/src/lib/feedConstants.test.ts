import { describe, expect, it } from "vitest"
import { MAX_FEED_BODY, feedBodyLength } from "./feedConstants"

describe("feedBodyLength (the realm's len(body): UTF-8 bytes of the trimmed body)", () => {
    it("counts ASCII one byte per character", () => {
        expect(feedBodyLength("hello")).toBe(5)
    })

    it("counts multi-byte characters as the realm does", () => {
        expect(feedBodyLength("é")).toBe(2)
        expect(feedBodyLength("🚀")).toBe(4)
        // 501 "é" is 501 JS characters but 1002 bytes: over the realm's cap.
        expect("é".repeat(501).length).toBeLessThanOrEqual(MAX_FEED_BODY)
        expect(feedBodyLength("é".repeat(501))).toBeGreaterThan(MAX_FEED_BODY)
    })

    it("ignores surrounding whitespace, which the client trims before sending", () => {
        expect(feedBodyLength("  hi \n")).toBe(2)
    })
})
