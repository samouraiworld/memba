import { describe, it, expect, beforeEach } from "vitest"
import { getLastSeenReply, setLastSeenReply } from "./feedLastSeen"

describe("feedLastSeen", () => {
    beforeEach(() => localStorage.clear())

    it("returns 0 when nothing has been seen yet", () => {
        expect(getLastSeenReply("g1me")).toBe(0n)
    })

    it("round-trips the last-seen reply id as a bigint", () => {
        setLastSeenReply("g1me", 123n)
        expect(getLastSeenReply("g1me")).toBe(123n)
    })

    it("is isolated per address", () => {
        setLastSeenReply("g1me", 5n)
        expect(getLastSeenReply("g1other")).toBe(0n)
    })

    it("tolerates a corrupt stored value", () => {
        localStorage.setItem("memba.feed.lastSeenReply.g1me", "not-a-number")
        expect(getLastSeenReply("g1me")).toBe(0n)
    })
})
