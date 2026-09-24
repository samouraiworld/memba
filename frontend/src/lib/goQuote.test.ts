import { describe, expect, it } from "vitest"
import { decodeGoQuoted, parseQevalGoJSON } from "./goQuote"

describe("decodeGoQuoted", () => {
    it("decodes Go's strconv.Quote output, including escapes JSON does not accept", () => {
        // Printed by Go 1.24 for a string holding U+1FAE9, U+F0000, BEL, VT, DEL, U+00AD, U+200B, e-acute, quotes, a backslash, U+0600 and U+2028.
        const quoted = String.raw`"a\U0001fae9b\U000f0000c\a\v\x7f\u00ad\u200b é \"q\" \\ \u0600 \u2028"`
        expect(decodeGoQuoted(quoted)).toBe("a\u{1FAE9}b\u{F0000}c\x07\x0b\x7f\u00ad\u200b \u00e9 \"q\" \\ \u0600 \u2028")
        expect(() => JSON.parse(quoted)).toThrow()
    })

    it("decodes the other simple escapes", () => {
        expect(decodeGoQuoted(String.raw`"\b\f\n\r\t"`)).toBe("\b\f\n\r\t")
        expect(decodeGoQuoted(`""`)).toBe("")
    })

    it("keeps an escaped backslash before a U from becoming an escape", () => {
        expect(decodeGoQuoted(String.raw`"\\U0001fae9"`)).toBe("\\U0001fae9")
        expect(decodeGoQuoted(String.raw`"\\\U0001fae9"`)).toBe("\\\u{1FAE9}")
    })

    it.each([
        ["no quotes", "abc"],
        ["an unescaped quote", String.raw`"a"b"`],
        ["a dangling backslash", String.raw`"a\"`],
        ["an unknown escape", String.raw`"\q"`],
        ["an octal escape", String.raw`"\101"`],
        ["a short \\U", String.raw`"\U1fae9"`],
        ["a non-hex \\u", String.raw`"\u00zz"`],
        ["a byte above ASCII", String.raw`"\xff"`],
        ["a surrogate", String.raw`"\ud800"`],
        ["a code point beyond Unicode", String.raw`"\U00110000"`],
        ["a raw control character", '"a\nb"'],
    ])("throws on %s", (_name, literal) => {
        expect(() => decodeGoQuoted(literal)).toThrow(SyntaxError)
    })
})

describe("parseQevalGoJSON", () => {
    it("parses a qeval string return whose JSON carries runes above U+FFFF", () => {
        const raw = String.raw`("{\"title\":\"x \U0001fae9 y\",\"n\":\"1\"}" string)`
        expect(parseQevalGoJSON(raw)).toEqual({ title: "x \u{1FAE9} y", n: "1" })
    })

    it("returns null for anything that is not a JSON string return", () => {
        for (const raw of ["(1 int)", `("{" string)`, `("x" string)`.replace("x", "\\q"), "", `("{}" bool)`]) {
            expect(parseQevalGoJSON(raw), raw).toBeNull()
        }
    })

    it("still accepts the JSON-only escapes the JSON.parse decode accepted", () => {
        expect(parseQevalGoJSON(String.raw`("[\"a\/b\"]" string)`)).toEqual(["a/b"])
        expect(parseQevalGoJSON(String.raw`("[\"\ud83d\ude80\"]" string)`)).toEqual(["\u{1F680}"])
    })

    it("rejects a raw control character, which neither strconv.Quote nor JSON writes", () => {
        // The payload "[\n1]" is valid JSON; only the literal carrying it is malformed.
        expect(parseQevalGoJSON('("[\n1]" string)')).toBeNull()
        expect(parseQevalGoJSON(String.raw`("[\n1]" string)`)).toEqual([1])
    })
})
