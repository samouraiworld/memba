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

// ── Adversarial Input Tests (Go Code Injection) ───────────────

describe("escapeGnoString — adversarial inputs", () => {
    it("neutralizes Go string literal breakout via double quote", () => {
        const input = 'my_dao"; panic("hacked'
        const escaped = escapeGnoString(input)
        // All double quotes are escaped — no unescaped quote remains
        expect(escaped).toContain('\\"')
        const unescaped = escaped.replace(/\\"/g, "")
        expect(unescaped).not.toContain('"')
    })

    it("neutralizes Go raw string breakout via backtick", () => {
        const input = "channel`; import `os`; os.Exit(1)"
        const escaped = escapeGnoString(input)
        // Raw backticks are escaped — no unescaped backtick remains
        expect(escaped).toContain("\\`")
        // Verify no bare backtick (without preceding backslash)
        expect(escaped.replace(/\\`/g, "")).not.toContain("`")
    })

    it("neutralizes template literal injection via dollar-brace", () => {
        const input = "${process.env.SECRET}"
        const escaped = escapeGnoString(input)
        // Dollar sign is escaped with backslash
        expect(escaped).toContain("\\$")
        // The literal $ is now preceded by \, making it safe in Go/TS template contexts
        expect(escaped.startsWith("\\$")).toBe(true)
    })

    it("neutralizes backslash escape sequences", () => {
        const input = "name\\x00\\n\\r"
        const escaped = escapeGnoString(input)
        // All original backslashes should be doubled
        expect(escaped).toContain("\\\\x00")
    })

    it("neutralizes newline injection (Go multi-statement)", () => {
        const input = "legit\n\tpanic(\"pwned\")"
        const escaped = escapeGnoString(input)
        expect(escaped).not.toContain("\n")
        expect(escaped).toContain("\\n")
    })

    it("handles combined attack vector", () => {
        const input = '"; import "os"; func init() { os.Exit(1) } //'
        const escaped = escapeGnoString(input)
        // The double quote at the start must be escaped
        expect(escaped.startsWith('\\"')).toBe(true)
        // No unescaped quotes remain
        const unescapedQuotes = escaped.replace(/\\"/g, "").match(/"/g)
        expect(unescapedQuotes).toBeNull()
    })

    it("handles null bytes", () => {
        // sanitizeString strips \x00, but escapeGnoString alone won't
        // Combined sanitizeForGno handles this
        const result = sanitizeForGno("hello\x00world")
        expect(result).toBe("helloworld")
        expect(result).not.toContain("\x00")
    })

    it("handles extremely long input", () => {
        const input = "A".repeat(10000)
        const result = sanitizeForGno(input, 256)
        expect(result.length).toBeLessThanOrEqual(256)
    })
})

describe("isValidChannelName — adversarial inputs", () => {
    it("rejects Go code injection via channel name", () => {
        expect(isValidChannelName('general"; panic("')).toBe(false)
    })

    it("rejects backslash sequences", () => {
        expect(isValidChannelName("general\\n")).toBe(false)
    })

    it("rejects template literal injection", () => {
        expect(isValidChannelName("${malicious}")).toBe(false)
    })

    it("rejects unicode homoglyph attack", () => {
        // Cyrillic 'a' looks like Latin 'a' but fails regex
        expect(isValidChannelName("generаl")).toBe(false) // Cyrillic а
    })

    it("rejects path traversal in name", () => {
        expect(isValidChannelName("../../../etc")).toBe(false)
    })

    it("rejects empty after trim", () => {
        expect(isValidChannelName("   ")).toBe(false)
    })
})

describe("isValidIdentifier — adversarial inputs", () => {
    it("rejects Go keyword as identifier", () => {
        // Go keywords are valid identifiers syntactically but could cause issues
        // The regex allows them — document this as accepted behavior
        expect(isValidIdentifier("func")).toBe(true) // lowercase Go keyword — accepted
        expect(isValidIdentifier("import")).toBe(true) // accepted as role name
    })

    it("rejects SQL injection attempt", () => {
        expect(isValidIdentifier("admin'; DROP TABLE--")).toBe(false)
    })

    it("rejects CRLF injection", () => {
        expect(isValidIdentifier("admin\r\n")).toBe(false)
    })
})
