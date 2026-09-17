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
})
