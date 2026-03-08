/**
 * Validator Data Layer Tests
 *
 * Tests formatting utilities (voting power, block time, address truncation).
 * RPC calls are integration-tested via the browser.
 */

import { describe, it, expect } from "vitest"
import { formatVotingPower, formatBlockTime, truncateValidatorAddr } from "./validators"

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
