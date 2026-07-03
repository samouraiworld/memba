/**
 * Tests for the directory URL schema (deep-linkable tab + global search).
 * W5.2: Packages is the default tab (most-filled on test13).
 */
import { describe, test, expect } from "vitest"
import { parseDirectoryUrl, serializeDirectoryUrl, DIRECTORY_TAB_KEYS, DEFAULT_DIRECTORY_TAB } from "./directoryUrl"

describe("parseDirectoryUrl", () => {
    test("defaults to the packages tab + empty query for an empty URL", () => {
        expect(DEFAULT_DIRECTORY_TAB).toBe("packages")
        expect(parseDirectoryUrl(new URLSearchParams())).toEqual({ tab: "packages", q: "" })
    })

    test("packages is the first tab in canonical order (W5.2 owner directive)", () => {
        expect(DIRECTORY_TAB_KEYS[0]).toBe("packages")
    })

    test("accepts every known tab", () => {
        for (const k of DIRECTORY_TAB_KEYS) {
            expect(parseDirectoryUrl(new URLSearchParams(`tab=${k}`)).tab).toBe(k)
        }
    })

    test("explicit ?tab=daos deep links still open DAOs", () => {
        expect(parseDirectoryUrl(new URLSearchParams("tab=daos")).tab).toBe("daos")
    })

    test("falls back to packages for an unknown tab", () => {
        expect(parseDirectoryUrl(new URLSearchParams("tab=bogus")).tab).toBe("packages")
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
    test("omits defaults (empty string for packages + no query)", () => {
        expect(serializeDirectoryUrl({ tab: "packages", q: "" }).toString()).toBe("")
    })

    test("emits a non-default tab (daos is no longer the default)", () => {
        expect(serializeDirectoryUrl({ tab: "daos", q: "" }).get("tab")).toBe("daos")
        expect(serializeDirectoryUrl({ tab: "realms", q: "" }).get("tab")).toBe("realms")
    })

    test("emits a non-empty query but omits a whitespace-only one", () => {
        expect(serializeDirectoryUrl({ tab: "packages", q: "foo" }).get("q")).toBe("foo")
        expect(serializeDirectoryUrl({ tab: "packages", q: "   " }).toString()).toBe("")
    })

    test("round-trips state through serialize → parse", () => {
        const s = { tab: "users" as const, q: "alice" }
        expect(parseDirectoryUrl(serializeDirectoryUrl(s))).toEqual(s)
    })
})
