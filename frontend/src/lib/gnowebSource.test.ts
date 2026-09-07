/**
 * Tests for gnowebSource — source code fetcher + parser.
 * Tests validation, HTML parsing, and import extraction.
 */
import { describe, it, expect, vi, afterEach } from "vitest"
import { fetchRealmHelp, isValidRealmPath } from "./gnowebSource"

function stubHelpPage(html: string): void {
    vi.stubGlobal(
        "fetch",
        vi.fn(async () => ({ ok: true, text: async () => html })),
    )
}

describe("gnowebSource", () => {
    describe("isValidRealmPath", () => {
        it("accepts valid realm paths", () => {
            expect(isValidRealmPath("/r/gov/dao")).toBe(true)
            expect(isValidRealmPath("/r/samcrew/memba_dao")).toBe(true)
            expect(isValidRealmPath("/p/demo/avl")).toBe(true)
        })

        it("rejects invalid paths (SSRF guard)", () => {
            expect(isValidRealmPath("")).toBe(false)
            expect(isValidRealmPath("http://evil.com")).toBe(false)
            expect(isValidRealmPath("/r/../../etc/passwd")).toBe(false)
            expect(isValidRealmPath("/r/foo bar")).toBe(false)
            expect(isValidRealmPath("javascript:alert(1)")).toBe(false)
        })

        it("accepts paths with hyphens", () => {
            expect(isValidRealmPath("/r/demo/boards-v2")).toBe(true)
            expect(isValidRealmPath("/r/foo-bar")).toBe(true)
        })

        it("rejects paths with uppercase or special chars", () => {
            expect(isValidRealmPath("/r/FOO/bar")).toBe(false)
        })
    })

    describe("fetchRealmHelp — entity decoding", () => {
        afterEach(() => {
            vi.unstubAllGlobals()
        })

        it("decodes HTML entities in signatures", async () => {
            stubHelpPage("<code>func Wrap(s string) &lt;T&gt;</code>")
            const fns = await fetchRealmHelp("https://gnoweb.test", "/r/demo/wrap")
            expect(fns).toEqual([
                { name: "Wrap", params: "(s string)", returns: "<T>", isExported: true },
            ])
        })

        it("decodes entity-encoded text once — &amp;lt; is the literal text &lt;", async () => {
            // gnoweb encodes a literal "&lt;" in source as "&amp;lt;". Decoding
            // "&amp;" before "&lt;" turns it into "<" (double decode); it must
            // survive as the literal text "&lt;".
            stubHelpPage("<code>func Escape(s string) &amp;lt;html&amp;gt;</code>")
            const fns = await fetchRealmHelp("https://gnoweb.test", "/r/demo/escape")
            expect(fns).toEqual([
                { name: "Escape", params: "(s string)", returns: "&lt;html&gt;", isExported: true },
            ])
        })
    })
})
