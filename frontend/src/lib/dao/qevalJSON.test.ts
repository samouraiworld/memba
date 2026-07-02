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
