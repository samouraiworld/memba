import { describe, expect, it } from "vitest"
import { MAX_FEED_BODY, FEED_LIMITS_NOTE, cooldownMessage, feedBodyLength } from "./feedConstants"

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

describe("feed posting limits", () => {
    it("states the byte cap and both cooldown phases before posting", () => {
        expect(FEED_LIMITS_NOTE).toContain("1000 bytes")
        expect(FEED_LIMITS_NOTE).toContain("12 blocks")
        expect(FEED_LIMITS_NOTE).toContain("2 blocks")
    })

    it("turns the realm cooldown into a useful message without changing other errors", () => {
        expect(cooldownMessage("VM panic: posting too fast: wait 12 blocks between posts")).toContain("12 more blocks")
        expect(cooldownMessage("body must be 1-1000 characters")).toBeNull()
    })
})
