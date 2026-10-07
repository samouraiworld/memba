import { describe, expect, it } from "vitest"

import { isGnoPrintable, isGnoPrintableCodePoint } from "./gnoPrintable"

describe("text as Gno's unicode.IsPrint takes it", () => {
    it("takes letters, marks, numbers, punctuation, symbols and the ASCII space", () => {
        for (const text of ["Relevés 2026", "Field drawings, signed.", "東京 · ソウル", "Ελληνικά", "😀", "a\u0301"]) expect(isGnoPrintable(text)).toBe(true)
    })

    it("refuses controls, other spaces and what Unicode 15 does not assign", () => {
        for (const text of ["a\u0007", "a\u00a0b", "a\u2028", "\u200b", "\u1C89", "\u2FFC", "\u31EF", "\ufffe"]) expect(isGnoPrintable(text)).toBe(false)
    })

    it("never takes a character the browser's own tables would not", () => {
        const browser = /^[\p{L}\p{M}\p{N}\p{P}\p{S} ]$/u
        let taken = 0
        for (let code = 0; code <= 0x10ffff; code++) {
            if (code >= 0xd800 && code <= 0xdfff) continue
            if (!isGnoPrintableCodePoint(code)) continue
            taken++
            if (!browser.test(String.fromCodePoint(code))) throw new Error(`U+${code.toString(16)} is in the table but not printable`)
        }
        // Unicode 15.0's letters, marks, numbers, punctuation and symbols, and the space.
        expect(taken).toBe(148_998)
    })
})
