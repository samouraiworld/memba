import { describe, it, expect } from "vitest"
import {
    estimateBlockDate,
    formatProposalDate,
    formatBlockDate,
    formatRelativeTime,
    DEFAULT_AVG_BLOCK_TIME_MS,
} from "./blockTime"

describe("blockTime", () => {
    // Fixed reference: 2026-04-04T12:00:00Z = 1775217600000ms
    const NOW = 1775217600000

    describe("estimateBlockDate", () => {
        it("estimates a block 100 blocks ago", () => {
            const date = estimateBlockDate(900, 1000, NOW, 2000)
            expect(date).not.toBeNull()
            // 100 blocks × 2000ms = 200,000ms = 200s ago
            expect(date!.getTime()).toBe(NOW - 200_000)
        })

        it("estimates current block as now", () => {
            const date = estimateBlockDate(1000, 1000, NOW, 2000)
            expect(date).not.toBeNull()
            expect(date!.getTime()).toBe(NOW)
        })

        it("returns null for blockHeight > currentBlock", () => {
            expect(estimateBlockDate(1001, 1000, NOW)).toBeNull()
        })

        it("returns null for blockHeight <= 0", () => {
            expect(estimateBlockDate(0, 1000, NOW)).toBeNull()
            expect(estimateBlockDate(-5, 1000, NOW)).toBeNull()
        })

        it("returns null for currentBlock <= 0", () => {
            expect(estimateBlockDate(100, 0, NOW)).toBeNull()
            expect(estimateBlockDate(100, -1, NOW)).toBeNull()
        })

        it("uses default block time of 2000ms", () => {
            expect(DEFAULT_AVG_BLOCK_TIME_MS).toBe(2000)
        })

        it("supports custom block time", () => {
            const date = estimateBlockDate(500, 1000, NOW, 5000)
            expect(date).not.toBeNull()
            // 500 blocks × 5000ms = 2,500,000ms
            expect(date!.getTime()).toBe(NOW - 2_500_000)
        })
    })

    describe("formatProposalDate", () => {
        it("formats a valid date with ~ prefix", () => {
            const date = new Date("2026-04-03T14:32:00")
            const result = formatProposalDate(date)
            expect(result).toMatch(/^~Apr 3, 2026 at 14:32$/)
        })

        it("pads single-digit hours and minutes", () => {
            const date = new Date("2026-01-05T09:05:00")
            const result = formatProposalDate(date)
            expect(result).toMatch(/^~Jan 5, 2026 at 09:05$/)
        })

        it("returns empty string for null", () => {
            expect(formatProposalDate(null)).toBe("")
        })

        it("returns empty string for invalid date", () => {
            expect(formatProposalDate(new Date("not-a-date"))).toBe("")
        })
    })

    describe("formatBlockDate", () => {
        it("combines estimation and formatting", () => {
            // 100 blocks ago at 2s/block = 200s ago
            const result = formatBlockDate(900, 1000, 2000)
            expect(result).toMatch(/^~/)
            expect(result.length).toBeGreaterThan(5)
        })

        it("returns empty string for invalid inputs", () => {
            expect(formatBlockDate(0, 1000)).toBe("")
            expect(formatBlockDate(1001, 1000)).toBe("")
        })
    })

    describe("formatRelativeTime", () => {
        it("returns 'just now' for <60s", () => {
            expect(formatRelativeTime(new Date(NOW - 5_000), NOW)).toBe("just now")
        })

        it("returns minutes ago", () => {
            expect(formatRelativeTime(new Date(NOW - 5 * 60_000), NOW)).toBe("5 minutes ago")
            expect(formatRelativeTime(new Date(NOW - 1 * 60_000), NOW)).toBe("1 minute ago")
        })

        it("returns hours ago", () => {
            expect(formatRelativeTime(new Date(NOW - 3 * 3600_000), NOW)).toBe("3 hours ago")
            expect(formatRelativeTime(new Date(NOW - 1 * 3600_000), NOW)).toBe("1 hour ago")
        })

        it("returns days ago", () => {
            expect(formatRelativeTime(new Date(NOW - 7 * 86400_000), NOW)).toBe("7 days ago")
            expect(formatRelativeTime(new Date(NOW - 1 * 86400_000), NOW)).toBe("1 day ago")
        })

        it("returns months ago", () => {
            expect(formatRelativeTime(new Date(NOW - 60 * 86400_000), NOW)).toBe("2 months ago")
        })

        it("returns empty string for null", () => {
            expect(formatRelativeTime(null)).toBe("")
        })

        it("handles future dates gracefully", () => {
            expect(formatRelativeTime(new Date(NOW + 60_000), NOW)).toBe("just now")
        })
    })
})
