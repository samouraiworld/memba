import { describe, it, expect } from "vitest"
import { relativeTime } from "./relativeTime"

const NOW = Date.parse("2026-07-06T12:00:00Z")
const ago = (s: number): bigint => BigInt(Math.floor(NOW / 1000) - s)

describe("relativeTime", () => {
    it("returns empty for an unknown (0) timestamp", () => {
        expect(relativeTime(0n, NOW)).toBe("")
    })

    it("shows 'just now' under 45 seconds", () => {
        expect(relativeTime(ago(10), NOW)).toBe("just now")
    })

    it("clamps a slightly-future timestamp (clock skew) to 'just now'", () => {
        expect(relativeTime(ago(-5), NOW)).toBe("just now")
    })

    it("shows minutes under an hour", () => {
        expect(relativeTime(ago(5 * 60), NOW)).toBe("5m")
    })

    it("shows hours under a day", () => {
        expect(relativeTime(ago(3 * 3600), NOW)).toBe("3h")
    })

    it("shows days under a week", () => {
        expect(relativeTime(ago(2 * 86400), NOW)).toBe("2d")
    })

    it("shows a month/day date beyond a week", () => {
        // 30 days before 2026-07-06 is 2026-06-06.
        expect(relativeTime(ago(30 * 86400), NOW)).toBe("Jun 6")
    })
})
