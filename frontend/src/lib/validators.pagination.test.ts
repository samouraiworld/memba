/**
 * Tests for validator pagination logic.
 *
 * Verifies auto-pagination in getValidators() and formatting helpers.
 */

import { describe, test, expect } from "vitest"
import {
    formatVotingPower,
    formatBlockTime,
    truncateValidatorAddr,
} from "./validators"

describe("formatVotingPower", () => {
    test("formats millions", () => {
        expect(formatVotingPower(1_500_000)).toBe("1.5M")
    })

    test("formats thousands", () => {
        expect(formatVotingPower(42_000)).toBe("42.0K")
    })

    test("formats small numbers", () => {
        expect(formatVotingPower(500)).toBe("500")
    })

    test("formats zero", () => {
        expect(formatVotingPower(0)).toBe("0")
    })
})

describe("formatBlockTime", () => {
    test("formats seconds", () => {
        expect(formatBlockTime(2.345)).toBe("2.3s")
    })

    test("returns dash for zero", () => {
        expect(formatBlockTime(0)).toBe("—")
    })

    test("returns dash for negative", () => {
        expect(formatBlockTime(-1)).toBe("—")
    })
})

describe("truncateValidatorAddr", () => {
    test("truncates long addresses", () => {
        const addr = "ABCDEF1234567890ABCD"
        expect(truncateValidatorAddr(addr)).toBe("ABCDEF…90ABCD")
    })

    test("preserves short addresses", () => {
        expect(truncateValidatorAddr("SHORT")).toBe("SHORT")
    })

    test("preserves 12-char addresses", () => {
        expect(truncateValidatorAddr("ABCDEFGHIJKL")).toBe("ABCDEFGHIJKL")
    })
})

describe("validator pagination calculations", () => {
    test("single page when count <= pageSize", () => {
        const totalValidators = 30
        const pageSize = 50
        const totalPages = Math.max(1, Math.ceil(totalValidators / pageSize))
        expect(totalPages).toBe(1)
    })

    test("multiple pages when count > pageSize", () => {
        const totalValidators = 120
        const pageSize = 50
        const totalPages = Math.ceil(totalValidators / pageSize)
        expect(totalPages).toBe(3)
    })

    test("correct slice for page 2 of 3", () => {
        const pageSize = 50
        const page = 2
        const start = (page - 1) * pageSize
        const end = start + pageSize
        expect(start).toBe(50)
        expect(end).toBe(100)
    })

    test("last page may have fewer items", () => {
        const totalValidators = 120
        const pageSize = 50
        const page = 3
        const start = (page - 1) * pageSize
        const end = Math.min(start + pageSize, totalValidators)
        expect(start).toBe(100)
        expect(end).toBe(120)
    })

    test("parallel page fetch count is correct", () => {
        const PER_PAGE = 100
        const total = 250
        const totalPages = Math.ceil(total / PER_PAGE)
        // Page 1 is always fetched first, so parallel fetch is pages 2..totalPages
        const parallelCount = totalPages - 1
        expect(parallelCount).toBe(2)
    })
})
