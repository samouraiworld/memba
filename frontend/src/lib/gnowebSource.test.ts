/**
 * Tests for gnowebSource — source code fetcher + parser.
 * Tests validation, HTML parsing, and import extraction.
 */
import { describe, it, expect } from "vitest"
import { isValidRealmPath } from "./gnowebSource"

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

        it("rejects paths with uppercase or special chars", () => {
            expect(isValidRealmPath("/r/FOO/bar")).toBe(false)
            expect(isValidRealmPath("/r/foo-bar")).toBe(false)
        })
    })
})
