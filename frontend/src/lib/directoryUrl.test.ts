/**
 * Tests for the directory URL schema (deep-linkable tab + global search).
 */
import { describe, test, expect } from "vitest"
import { parseDirectoryUrl, serializeDirectoryUrl, DIRECTORY_TAB_KEYS } from "./directoryUrl"

describe("parseDirectoryUrl", () => {
    test("defaults to the daos tab + empty query for an empty URL", () => {
        expect(parseDirectoryUrl(new URLSearchParams())).toEqual({ tab: "daos", q: "" })
    })

    test("accepts every known tab", () => {
        for (const k of DIRECTORY_TAB_KEYS) {
            expect(parseDirectoryUrl(new URLSearchParams(`tab=${k}`)).tab).toBe(k)
        }
    })

    test("falls back to daos for an unknown tab", () => {
        expect(parseDirectoryUrl(new URLSearchParams("tab=bogus")).tab).toBe("daos")
    })

    test("reads the query", () => {
        expect(parseDirectoryUrl(new URLSearchParams("q=hello")).q).toBe("hello")
    })

    test("caps an over-long query at 200 chars", () => {
        const long = "x".repeat(500)
        expect(parseDirectoryUrl(new URLSearchParams(`q=${long}`)).q.length).toBe(200)
    })
})

describe("serializeDirectoryUrl", () => {
    test("omits defaults (empty string for daos + no query)", () => {
        expect(serializeDirectoryUrl({ tab: "daos", q: "" }).toString()).toBe("")
    })

    test("emits a non-default tab", () => {
        expect(serializeDirectoryUrl({ tab: "realms", q: "" }).get("tab")).toBe("realms")
    })

    test("emits a non-empty query but omits a whitespace-only one", () => {
        expect(serializeDirectoryUrl({ tab: "daos", q: "foo" }).get("q")).toBe("foo")
        expect(serializeDirectoryUrl({ tab: "daos", q: "   " }).toString()).toBe("")
    })

    test("round-trips state through serialize → parse", () => {
        const s = { tab: "users" as const, q: "alice" }
        expect(parseDirectoryUrl(serializeDirectoryUrl(s))).toEqual(s)
    })
})
