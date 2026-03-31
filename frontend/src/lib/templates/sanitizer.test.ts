/**
 * Template Sanitizer Tests — comprehensive coverage for Gno realm input validation.
 *
 * Tests injection attempts, valid inputs, edge cases, and boundary conditions
 * for the centralized sanitizer used by ALL template generators.
 */

import { describe, it, expect } from "vitest"
import {
    isValidGnoAddress,
    isValidIdentifier,
    isValidChannelName,
    sanitizeString,
    escapeGnoString,
    sanitizeForGno,
    validateRealmPath,
    extractPkgName,
    clampInt,
    isValidPercentage,
} from "./sanitizer"

// ── Address Validation ──────────────────────────────────────

describe("isValidGnoAddress", () => {
    it("accepts valid g1 addresses (38 lowercase alphanum after prefix)", () => {
        expect(isValidGnoAddress("g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5")).toBe(true)
    })

    it("rejects empty string", () => {
        expect(isValidGnoAddress("")).toBe(false)
    })

    it("rejects null/undefined", () => {
        expect(isValidGnoAddress(null as unknown as string)).toBe(false)
        expect(isValidGnoAddress(undefined as unknown as string)).toBe(false)
    })

    it("rejects too short address", () => {
        expect(isValidGnoAddress("g1abc")).toBe(false)
    })

    it("rejects uppercase in address", () => {
        expect(isValidGnoAddress("g1JG8MTUTU9KHHFWC4NXMUHCPFTF0PAJDHFVSQF5")).toBe(false)
    })

    it("rejects wrong prefix", () => {
        expect(isValidGnoAddress("cosmos1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5")).toBe(false)
    })

    it("rejects address with special characters", () => {
        expect(isValidGnoAddress("g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhf!sqf5")).toBe(false)
    })

    it("rejects address with injection attempt (backtick)", () => {
        expect(isValidGnoAddress("g1`; DROP TABLE users; --")).toBe(false)
    })

    it("rejects address with newline injection", () => {
        expect(isValidGnoAddress("g1abc\nmalicious")).toBe(false)
    })
})

// ── Identifier Validation ───────────────────────────────────

describe("isValidIdentifier", () => {
    it("accepts simple role names", () => {
        expect(isValidIdentifier("admin")).toBe(true)
        expect(isValidIdentifier("member")).toBe(true)
        expect(isValidIdentifier("dev")).toBe(true)
    })

    it("accepts names with underscores", () => {
        expect(isValidIdentifier("finance_lead")).toBe(true)
    })

    it("accepts names with numbers", () => {
        expect(isValidIdentifier("team1")).toBe(true)
    })

    it("rejects names starting with numbers", () => {
        expect(isValidIdentifier("1admin")).toBe(false)
    })

    it("rejects names with spaces", () => {
        expect(isValidIdentifier("team lead")).toBe(false)
    })

    it("rejects names with hyphens", () => {
        expect(isValidIdentifier("team-lead")).toBe(false)
    })

    it("rejects names over 30 chars", () => {
        expect(isValidIdentifier("a".repeat(31))).toBe(false)
    })

    it("accepts names exactly 30 chars", () => {
        expect(isValidIdentifier("a".repeat(30))).toBe(true)
    })

    it("rejects empty string", () => {
        expect(isValidIdentifier("")).toBe(false)
    })

    it("rejects injection attempt", () => {
        expect(isValidIdentifier("admin\"; panic(\"hacked")).toBe(false)
    })
})

// ── Channel Name Validation ─────────────────────────────────

describe("isValidChannelName", () => {
    it("accepts simple channel names", () => {
        expect(isValidChannelName("general")).toBe(true)
    })

    it("accepts names with hyphens", () => {
        expect(isValidChannelName("dev-chat")).toBe(true)
    })

    it("accepts names with underscores", () => {
        expect(isValidChannelName("dev_chat")).toBe(true)
    })

    it("rejects names with spaces", () => {
        expect(isValidChannelName("dev chat")).toBe(false)
    })

    it("rejects names over 30 chars", () => {
        expect(isValidChannelName("a".repeat(31))).toBe(false)
    })

    it("rejects uppercase", () => {
        expect(isValidChannelName("General")).toBe(false)
    })
})

// ── String Sanitization ─────────────────────────────────────

describe("sanitizeString", () => {
    it("strips control characters", () => {
        expect(sanitizeString("hello\x00world")).toBe("helloworld")
        expect(sanitizeString("hello\nworld")).toBe("helloworld")
        expect(sanitizeString("hello\tworld")).toBe("helloworld")
    })

    it("trims whitespace", () => {
        expect(sanitizeString("  hello  ")).toBe("hello")
    })

    it("enforces max length", () => {
        expect(sanitizeString("a".repeat(300), 256)).toBe("a".repeat(256))
    })

    it("handles custom max length", () => {
        expect(sanitizeString("abcdef", 3)).toBe("abc")
    })

    it("returns empty string for non-string input", () => {
        expect(sanitizeString(123 as unknown as string)).toBe("")
        expect(sanitizeString(null as unknown as string)).toBe("")
    })

    it("preserves normal text", () => {
        expect(sanitizeString("My DAO Description")).toBe("My DAO Description")
    })

    it("strips null bytes", () => {
        expect(sanitizeString("hello\0world")).toBe("helloworld")
    })

    it("strips unicode control characters", () => {
        expect(sanitizeString("hello\x1Fworld")).toBe("helloworld")
    })
})

// ── Gno String Escaping ─────────────────────────────────────

describe("escapeGnoString", () => {
    it("escapes backslashes", () => {
        expect(escapeGnoString("path\\to\\file")).toBe("path\\\\to\\\\file")
    })

    it("escapes double quotes", () => {
        expect(escapeGnoString('say "hello"')).toBe('say \\"hello\\"')
    })

    it("escapes backticks", () => {
        expect(escapeGnoString("use `gno test`")).toBe("use \\`gno test\\`")
    })

    it("escapes dollar signs", () => {
        expect(escapeGnoString("${injection}")).toBe("\\${injection}")
    })

    it("handles combined escaping", () => {
        const input = 'test \\ "quote" `backtick` ${var}'
        const result = escapeGnoString(input)
        expect(result).toBe('test \\\\ \\"quote\\" \\`backtick\\` \\${var}')
    })

    it("preserves safe characters", () => {
        expect(escapeGnoString("Hello World 123 !@#%^&*()")).toBe("Hello World 123 !@#%^&*()")
    })
})

// ── Combined Sanitize + Escape ──────────────────────────────

describe("sanitizeForGno", () => {
    it("strips control chars AND escapes", () => {
        expect(sanitizeForGno('hello\nworld "test"')).toBe('helloworld \\"test\\"')
    })

    it("enforces max length before escaping", () => {
        const input = "a".repeat(300)
        const result = sanitizeForGno(input, 256)
        expect(result.length).toBeLessThanOrEqual(256)
    })
})

// ── Realm Path Validation ───────────────────────────────────

describe("validateRealmPath", () => {
    it("accepts valid paths", () => {
        expect(validateRealmPath("gno.land/r/samcrew/memba_dao")).toBeNull()
        expect(validateRealmPath("gno.land/r/username/myrealm")).toBeNull()
    })

    it("rejects paths without gno.land/r/ prefix", () => {
        expect(validateRealmPath("gno.land/p/demo/avl")).not.toBeNull()
        expect(validateRealmPath("/r/samcrew/dao")).not.toBeNull()
    })

    it("rejects paths with only one segment", () => {
        expect(validateRealmPath("gno.land/r/singlename")).not.toBeNull()
    })

    it("rejects empty segments", () => {
        expect(validateRealmPath("gno.land/r/samcrew//dao")).not.toBeNull()
    })

    it("rejects uppercase segments", () => {
        expect(validateRealmPath("gno.land/r/samcrew/MyDAO")).not.toBeNull()
    })

    it("rejects names shorter than 3 chars", () => {
        expect(validateRealmPath("gno.land/r/samcrew/ab")).not.toBeNull()
    })

    it("rejects names longer than 30 chars", () => {
        expect(validateRealmPath("gno.land/r/samcrew/" + "a".repeat(31))).not.toBeNull()
    })
})

// ── Utility Functions ───────────────────────────────────────

describe("extractPkgName", () => {
    it("extracts last segment", () => {
        expect(extractPkgName("gno.land/r/samcrew/memba_dao")).toBe("memba_dao")
    })

    it("returns fallback for empty path", () => {
        expect(extractPkgName("", "fallback")).toBe("fallback")
    })
})

describe("clampInt", () => {
    it("clamps below minimum", () => {
        expect(clampInt(-5, 0, 100)).toBe(0)
    })

    it("clamps above maximum", () => {
        expect(clampInt(150, 0, 100)).toBe(100)
    })

    it("floors decimal values", () => {
        expect(clampInt(3.7, 0, 10)).toBe(3)
    })

    it("preserves values within range", () => {
        expect(clampInt(50, 0, 100)).toBe(50)
    })
})

describe("isValidPercentage", () => {
    it("accepts 0 and 100", () => {
        expect(isValidPercentage(0)).toBe(true)
        expect(isValidPercentage(100)).toBe(true)
    })

    it("rejects negative", () => {
        expect(isValidPercentage(-1)).toBe(false)
    })

    it("rejects over 100", () => {
        expect(isValidPercentage(101)).toBe(false)
    })

    it("rejects NaN and Infinity", () => {
        expect(isValidPercentage(NaN)).toBe(false)
        expect(isValidPercentage(Infinity)).toBe(false)
    })
})
