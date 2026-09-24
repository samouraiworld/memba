/**
 * parseQevalJSON — the REAL frontend decode of a `vm/qeval` JSON string return.
 *
 * The realm's GetProposalsJSON() output travels the wire as a Go-quoted string
 * literal `("<escaped>" string)`. This suite feeds parseQevalJSON exactly that
 * form (built with a faithful strconv.Quote simulation) and proves the payload —
 * including titles with quotes, newlines, tabs, and BACKSLASHES — round-trips.
 * The old single-pass `.replace(/\\"/g,'"')` corrupted backslash/newline fields;
 * these tests are the regression guard for that (W1.4 review finding).
 */
import { describe, it, expect } from "vitest"
import { parseQevalJSON } from "./shared"

/** Faithful strconv.Quote: what gno's qeval printer does to a returned string. */
function goQuote(s: string): string {
    let out = '"'
    for (const ch of s) {
        if (ch === '"') out += '\\"'
        else if (ch === "\\") out += "\\\\"
        else if (ch === "\n") out += "\\n"
        else if (ch === "\r") out += "\\r"
        else if (ch === "\t") out += "\\t"
        else if (ch < " ") out += "\\u" + ch.charCodeAt(0).toString(16).padStart(4, "0")
        else out += ch
    }
    return out + '"'
}

/** Wrap a realm return value the way vm/qeval does before the frontend sees it. */
function asQeval(realmReturn: string): string {
    return `(${goQuote(realmReturn)} string)`
}

describe("parseQevalJSON — wire-format decode (W1.4)", () => {
    it("decodes a plain JSON array", () => {
        const realm = JSON.stringify([{ id: 1, title: "hello", yes_votes: 3 }])
        const parsed = parseQevalJSON(asQeval(realm)) as Array<Record<string, unknown>>
        expect(Array.isArray(parsed)).toBe(true)
        expect(parsed[0].title).toBe("hello")
        expect(parsed[0].yes_votes).toBe(3)
    })

    it("round-trips a title with embedded double-quotes", () => {
        const realm = JSON.stringify([{ id: 1, title: 'Adopt "v2" charter' }])
        const parsed = parseQevalJSON(asQeval(realm)) as Array<{ title: string }>
        expect(parsed[0].title).toBe('Adopt "v2" charter')
    })

    it("round-trips a title with a BACKSLASH (the case the old decoder corrupted)", () => {
        const realm = JSON.stringify([{ id: 1, title: "path\\to\\thing" }])
        const parsed = parseQevalJSON(asQeval(realm)) as Array<{ title: string }>
        expect(parsed[0].title).toBe("path\\to\\thing")
    })

    it("round-trips newline + tab in a description", () => {
        const realm = JSON.stringify([{ id: 1, title: "t", description: "line1\nline2\tcol" }])
        const parsed = parseQevalJSON(asQeval(realm)) as Array<{ description: string }>
        expect(parsed[0].description).toBe("line1\nline2\tcol")
    })

    it("decodes an empty array", () => {
        expect(parseQevalJSON(asQeval("[]"))).toEqual([])
    })

    it("returns null on a non-qeval / malformed string (caller falls back to Render)", () => {
        expect(parseQevalJSON("# Not Found")).toBeNull()
        expect(parseQevalJSON("(garbage string)")).toBeNull()
        expect(parseQevalJSON('("not json" string)')).toBeNull()
    })
})

/*
 * Printed by Go 1.24's strconv.Quote over the DAO realm's JSON string encoder
 * (which writes BEL and VT as \u0007 / \u000b) for the title
 * "Ban U+1FAE9 spam U+F0000 bell<BEL> vt<VT> del<DEL>". The node's Unicode
 * tables predate U+1FAE9 and U+F0000 is private use, so both come out as
 * \UXXXXXXXX; DEL comes out as \x7f. JSON.parse rejects \U and \x.
 */
const GO_TITLE = "Ban \u{1FAE9} spam \u{F0000} bell\x07 vt\x0b del\x7f"
const GO_LIST = String.raw`("[{\"id\":7,\"title\":\"Ban \U0001fae9 spam \U000f0000 bell\\u0007 vt\\u000b del\x7f\",\"status\":\"active\"}]" string)`

describe("parseQevalJSON — strconv.Quote escapes JSON.parse rejects", () => {
    it("decodes a proposal list whose title the node prints with \\U and \\x escapes", () => {
        expect(() => JSON.parse(GO_LIST.slice(1, -8))).toThrow()
        expect(parseQevalJSON(GO_LIST)).toEqual([{ id: 7, title: GO_TITLE, status: "active" }])
    })

    it.each([
        [String.raw`\U0001fae9`, "\u{1FAE9}"],
        [String.raw`\U000f0000`, "\u{F0000}"],
        [String.raw`\x7f`, "\x7f"],
    ])("decodes %s", (escape, rune) => {
        expect(parseQevalJSON(`("[\\"a${escape}b\\"]" string)`)).toEqual([`a${rune}b`])
    })

    it("returns null, not garbage, when \\a or \\v stand for a raw BEL or VT inside a JSON string", () => {
        // Printed by Go for the payload ["a<BEL><VT>"]: the literal decodes, but
        // the payload is not JSON (JSON strings cannot hold raw control characters).
        expect(parseQevalJSON(String.raw`("[\"a\a\v\"]" string)`)).toBeNull()
    })
})

/** The decode parseQevalJSON used before it handled the strconv.Quote grammar. */
function legacyParseQevalJSON(raw: string): unknown {
    const m = raw.match(/^\(\s*("[\s\S]*")\s+string\s*\)\s*$/)
    if (!m) return null
    try {
        const payload = JSON.parse(m[1])
        if (typeof payload !== "string") return null
        return JSON.parse(payload)
    } catch {
        return null
    }
}

describe("parseQevalJSON — backward compatibility with the JSON.parse decode", () => {
    it("accepts the JSON-only escapes \\/ and \\u surrogates", () => {
        expect(parseQevalJSON(String.raw`("[\"a\/b\"]" string)`)).toEqual(["a/b"])
        expect(parseQevalJSON(String.raw`("[\"🚀\"]" string)`)).toEqual(["\u{1F680}"])
    })

    it("returns the same value for every literal the old decode accepted", () => {
        // Deterministic xorshift so a failure reproduces.
        let seed = 0x9e3779b9
        const rand = (n: number) => {
            seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5
            return (seed >>> 0) % n
        }
        const alphabet = ['"', "\\", "/", "a", " ", "\n", "\t", "\x07", "\x0b", "\x7f", "é", " ", "\u{1F680}", "\u{1FAE9}", "\u{F0000}", "\ud800", "\udfff"]
        // A JSON-valid literal that escapes every non-ASCII code unit and every slash.
        const asciiQuote = (s: string) => JSON.stringify(s)
            .replace(/[^\x20-\x7e]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"))
            .replace(/\//g, "\\/")
        let accepted = 0
        for (let n = 0; n < 500; n++) {
            let s = ""
            for (let k = rand(12); k > 0; k--) s += alphabet[rand(alphabet.length)]
            const payload = JSON.stringify([s, { k: s }])
            for (const literal of [JSON.stringify(payload), asciiQuote(payload), goQuote(payload)]) {
                const raw = `(${literal} string)`
                const before = legacyParseQevalJSON(raw)
                if (before === null) continue
                accepted++
                expect(parseQevalJSON(raw), raw).toEqual(before)
            }
        }
        expect(accepted).toBeGreaterThan(1000)
    })
})
