/**
 * Validator Data Layer Tests
 *
 * Tests formatting utilities (voting power, block time, address truncation,
 * relative time) and pure logic from the Hacker View data layer.
 * RPC calls are integration-tested via the browser.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import {
    formatVotingPower,
    formatBlockTime,
    truncateValidatorAddr,
    formatRelativeTime,
    type BlockSample,
} from "./validators"

// ── formatVotingPower ─────────────────────────────────────────

describe("formatVotingPower", () => {
    it("formats small values as-is", () => {
        expect(formatVotingPower(500)).toBe("500")
    })

    it("formats thousands with K suffix", () => {
        expect(formatVotingPower(1_500)).toBe("1.5K")
    })

    it("formats exact thousands", () => {
        expect(formatVotingPower(1_000)).toBe("1.0K")
    })

    it("formats millions with M suffix", () => {
        expect(formatVotingPower(2_500_000)).toBe("2.5M")
    })

    it("formats zero", () => {
        expect(formatVotingPower(0)).toBe("0")
    })
})

// ── formatBlockTime ───────────────────────────────────────────

describe("formatBlockTime", () => {
    it("formats seconds with one decimal", () => {
        expect(formatBlockTime(2.5)).toBe("2.5s")
    })

    it("returns dash for zero", () => {
        expect(formatBlockTime(0)).toBe("—")
    })

    it("returns dash for negative", () => {
        expect(formatBlockTime(-1)).toBe("—")
    })

    it("formats whole seconds", () => {
        expect(formatBlockTime(5.0)).toBe("5.0s")
    })
})

// ── truncateValidatorAddr ─────────────────────────────────────

describe("truncateValidatorAddr", () => {
    it("truncates long addresses", () => {
        const addr = "ABCDEF1234567890ABCDEF1234567890ABCDEF12"
        const result = truncateValidatorAddr(addr)
        expect(result).toBe("ABCDEF…CDEF12")
        expect(result.length).toBeLessThan(addr.length)
    })

    it("returns short addresses as-is", () => {
        expect(truncateValidatorAddr("ABC")).toBe("ABC")
    })

    it("handles exactly 12 chars", () => {
        expect(truncateValidatorAddr("123456789012")).toBe("123456789012")
    })
})

// ── formatRelativeTime ────────────────────────────────────────

describe("formatRelativeTime", () => {
    const NOW = new Date("2026-03-17T16:00:00.000Z").getTime()

    beforeEach(() => {
        vi.useFakeTimers()
        vi.setSystemTime(NOW)
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    it("returns dash for empty string", () => {
        expect(formatRelativeTime("")).toBe("—")
    })

    it("returns dash for invalid ISO string", () => {
        expect(formatRelativeTime("not-a-date")).toBe("—")
    })

    it("returns 'Today' for same-day timestamp", () => {
        const sameDay = new Date(NOW - 1000 * 60 * 30).toISOString() // 30 min ago
        expect(formatRelativeTime(sameDay)).toBe("Today")
    })

    it("returns '1 day ago' for yesterday", () => {
        const yesterday = new Date(NOW - 1000 * 60 * 60 * 25).toISOString() // 25h ago
        expect(formatRelativeTime(yesterday)).toBe("1 day ago")
    })

    it("returns 'N days ago' for older timestamps", () => {
        const old = new Date(NOW - 1000 * 60 * 60 * 24 * 10).toISOString() // 10 days ago
        expect(formatRelativeTime(old)).toBe("10 days ago")
    })

    it("returns dash for future timestamps", () => {
        const future = new Date(NOW + 1000 * 60 * 60).toISOString() // 1h in future
        expect(formatRelativeTime(future)).toBe("—")
    })
})

// ── BlockSample type contract ─────────────────────────────────

describe("BlockSample type contract", () => {
    it("healthRatio is between 0 and 1 for valid blocks", () => {
        const sample: BlockSample = {
            height: 1000,
            signerCount: 7,
            valsetSize: 10,
            perfect: false,
            healthRatio: 7 / 10,
            time: "2026-03-17T12:00:00Z",
        }
        expect(sample.healthRatio).toBeGreaterThanOrEqual(0)
        expect(sample.healthRatio).toBeLessThanOrEqual(1)
    })

    it("perfect is true when all validators signed", () => {
        const sample: BlockSample = {
            height: 1001,
            signerCount: 10,
            valsetSize: 10,
            perfect: true,
            healthRatio: 1.0,
            time: "2026-03-17T12:00:05Z",
        }
        expect(sample.perfect).toBe(true)
        expect(sample.healthRatio).toBe(1.0)
    })

    it("perfect is false for partial signing", () => {
        const sample: BlockSample = {
            height: 1002,
            signerCount: 8,
            valsetSize: 10,
            perfect: false,
            healthRatio: 0.8,
            time: "2026-03-17T12:00:10Z",
        }
        expect(sample.perfect).toBe(false)
    })
})
