import { describe, expect, it } from "vitest"
import { hasInvisibleFormatting, revealInvisibleFormatting, v2CharCount, v2DescriptionProblem, v2TitleProblem } from "./v2Text"

describe("version-2 proposal text rules", () => {
    it("accepts titles the realm accepts", () => {
        expect(v2TitleProblem("Add Dana to the team")).toBeNull()
        expect(v2TitleProblem("€".repeat(128))).toBeNull()
        expect(v2TitleProblem("🚀".repeat(128))).toBeNull()
    })

    it("refuses titles the realm refuses", () => {
        expect(v2TitleProblem("")).toMatch(/Enter a title/)
        expect(v2TitleProblem("   ")).toMatch(/Enter a title/)
        expect(v2TitleProblem("a".repeat(129))).toMatch(/at most 128/)
        expect(v2TitleProblem("two\nlines")).toMatch(/single line/)
        expect(v2TitleProblem("tab\there")).toMatch(/single line/)
        expect(v2TitleProblem("del")).toMatch(/single line/)
        expect(v2TitleProblem("sep ")).toMatch(/single line/)
        for (const ch of ["‮", "​", "﻿", "⁦", "­", "\u{E0001}"]) {
            expect(v2TitleProblem(`title${ch}`)).toMatch(/invisible formatting/)
        }
    })

    it("applies the description rules", () => {
        expect(v2DescriptionProblem("line one\n\tline two")).toBeNull()
        expect(v2DescriptionProblem("🚀".repeat(8000))).toBeNull()
        expect(v2DescriptionProblem("a".repeat(8001))).toMatch(/at most 8,000/)
        expect(v2DescriptionProblem("windows\r\nline")).toMatch(/control characters/)
        // Accepted by the realm, but flagged for readers.
        expect(v2DescriptionProblem("pay ‮evil")).toBeNull()
    })

    it("counts characters as code points", () => {
        expect(v2CharCount("🚀é")).toBe(2)
    })

    it("reveals invisible formatting characters", () => {
        expect(hasInvisibleFormatting("plain text")).toBe(false)
        expect(hasInvisibleFormatting("a‮b")).toBe(true)
        expect(revealInvisibleFormatting("a‮b​c\u{E0001}")).toBe("a[U+202E]b[U+200B]c[U+E0001]")
        expect(revealInvisibleFormatting("no change")).toBe("no change")
    })

    it("also reveals invisible fillers and variation selectors that are not format characters", () => {
        for (const [ch, marker] of [["\uFE0F", "[U+FE0F]"], ["\uFE00", "[U+FE00]"], ["\u{E0100}", "[U+E0100]"], ["\u{E01EF}", "[U+E01EF]"], ["\u3164", "[U+3164]"], ["\uFFA0", "[U+FFA0]"], ["\u115F", "[U+115F]"], ["\u1160", "[U+1160]"]]) {
            expect(hasInvisibleFormatting(`a${ch}b`), marker).toBe(true)
            expect(revealInvisibleFormatting(`a${ch}b`)).toBe(`a${marker}b`)
        }
        // The realm's title rule refuses only format characters; the form mirrors it exactly.
        expect(v2TitleProblem("Hangul\u3164filler")).toBeNull()
    })
})
