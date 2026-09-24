/**
 * goQuote.ts — decode a Go-quoted string literal, as `vm/qeval` prints a Gno
 * string return: `("<strconv.Quote output>" string)`.
 *
 * strconv.Quote output is not always valid JSON. Printable runes pass through,
 * but it escapes non-printable ones as `\a`, `\v`, `\xHH` (below U+0080),
 * `\uHHHH` and `\UHHHHHHHH`. The last form covers every non-printable rune
 * above U+FFFF, such as characters newer than the node's Unicode tables (e.g.
 * U+1FAE9) and private-use planes (U+F0000). JSON.parse rejects `\a`, `\v`,
 * `\x` and `\U`, so decoding with JSON.parse fails on text a realm stores
 * legitimately. This decoder accepts exactly the escapes strconv.Quote writes
 * and throws on anything else.
 */

const SIMPLE: Record<string, string> = {
    a: "\x07",
    b: "\b",
    f: "\f",
    n: "\n",
    r: "\r",
    t: "\t",
    v: "\v",
    "\\": "\\",
    '"': '"',
}

const HEX_DIGITS: Record<string, number> = { x: 2, u: 4, U: 8 }

/** Decode `"…"` written by Go's strconv.Quote. Throws on anything strconv.Quote does not produce. */
export function decodeGoQuoted(literal: string): string {
    if (literal.length < 2 || literal[0] !== '"' || literal[literal.length - 1] !== '"') throw new SyntaxError("Not a quoted string")
    let out = ""
    for (let i = 1; i < literal.length - 1; i++) {
        const c = literal[i]
        if (c === '"') throw new SyntaxError("Unescaped quote")
        if (c !== "\\") {
            out += c
            continue
        }
        const e = literal[++i]
        if (i >= literal.length - 1) throw new SyntaxError("Dangling backslash")
        if (e in SIMPLE) {
            out += SIMPLE[e]
            continue
        }
        const n = HEX_DIGITS[e]
        if (!n) throw new SyntaxError(`Unknown escape \\${e}`)
        const hex = literal.slice(i + 1, i + 1 + n)
        if (hex.length !== n || !/^[0-9a-fA-F]+$/.test(hex)) throw new SyntaxError(`Bad \\${e} escape`)
        const cp = parseInt(hex, 16)
        // \x is a single byte: strconv.Quote uses it only for ASCII controls (and
        // for invalid UTF-8 bytes, which cannot be represented in a JS string).
        if (e === "x" && cp >= 0x80) throw new SyntaxError("Invalid UTF-8 byte")
        if (cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) throw new SyntaxError("Invalid code point")
        out += String.fromCodePoint(cp)
        i += n
    }
    return out
}

/**
 * Decode a qeval string return that carries JSON — `("<go-quoted-json>" string)`
 * — into the parsed value, or null on any failure.
 */
export function parseQevalGoJSON(raw: string): unknown {
    const m = raw.match(/^\(\s*("[\s\S]*")\s+string\s*\)\s*$/)
    if (!m) return null
    try {
        return JSON.parse(decodeGoQuoted(m[1]))
    } catch {
        return null
    }
}
