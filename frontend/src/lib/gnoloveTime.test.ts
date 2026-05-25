import { describe, it, expect } from "vitest"
import { formatRelativeTime, isStale } from "./gnoloveTime"

const NOW = new Date("2026-05-25T12:00:00Z").getTime()

describe("formatRelativeTime", () => {
    it("returns dash for null/undefined", () => {
        expect(formatRelativeTime(null, NOW)).toBe("—")
        expect(formatRelativeTime(undefined, NOW)).toBe("—")
    })

    it("returns dash for invalid ISO", () => {
        expect(formatRelativeTime("not-a-date", NOW)).toBe("—")
    })

    it("returns 'just now' for <60s ago", () => {
        const iso = new Date(NOW - 30_000).toISOString()
        expect(formatRelativeTime(iso, NOW)).toBe("just now")
    })

    it("returns minutes for 1-59m ago", () => {
        const iso = new Date(NOW - 5 * 60_000).toISOString()
        expect(formatRelativeTime(iso, NOW)).toBe("5m ago")
    })

    it("returns hours for 1-23h ago", () => {
        const iso = new Date(NOW - 3 * 3_600_000).toISOString()
        expect(formatRelativeTime(iso, NOW)).toBe("3h ago")
    })

    it("returns days for >=24h ago", () => {
        const iso = new Date(NOW - 48 * 3_600_000).toISOString()
        expect(formatRelativeTime(iso, NOW)).toBe("2d ago")
    })
})

describe("isStale", () => {
    it("returns false for null/undefined", () => {
        expect(isStale(null, NOW)).toBe(false)
        expect(isStale(undefined, NOW)).toBe(false)
    })

    it("returns false when within 24h", () => {
        const iso = new Date(NOW - 12 * 3_600_000).toISOString()
        expect(isStale(iso, NOW)).toBe(false)
    })

    it("returns true when >24h ago", () => {
        const iso = new Date(NOW - 25 * 3_600_000).toISOString()
        expect(isStale(iso, NOW)).toBe(true)
    })

    it("returns false for invalid date", () => {
        expect(isStale("garbage", NOW)).toBe(false)
    })
})
