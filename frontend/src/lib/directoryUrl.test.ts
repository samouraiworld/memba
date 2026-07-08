/**
 * Tests for the directory URL schema (deep-linkable tab + global search).
 * W5.2: Packages is the default tab (most-filled on test13).
 */
import { describe, test, expect } from "vitest"
import { parseDirectoryUrl, serializeDirectoryUrl, resolveActiveTab, DIRECTORY_TAB_KEYS, DEFAULT_DIRECTORY_TAB } from "./directoryUrl"

describe("parseDirectoryUrl", () => {
    test("defaults to the packages tab + empty query for an empty URL", () => {
        expect(DEFAULT_DIRECTORY_TAB).toBe("packages")
        expect(parseDirectoryUrl(new URLSearchParams())).toEqual({ tab: "packages", q: "", realm: "" })
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
        expect(serializeDirectoryUrl({ tab: "packages", q: "", realm: "" }).toString()).toBe("")
    })

    test("emits a non-default tab (daos is no longer the default)", () => {
        expect(serializeDirectoryUrl({ tab: "daos", q: "", realm: "" }).get("tab")).toBe("daos")
        expect(serializeDirectoryUrl({ tab: "realms", q: "", realm: "" }).get("tab")).toBe("realms")
    })

    test("emits a non-empty query but omits a whitespace-only one", () => {
        expect(serializeDirectoryUrl({ tab: "packages", q: "foo", realm: "" }).get("q")).toBe("foo")
        expect(serializeDirectoryUrl({ tab: "packages", q: "   ", realm: "" }).toString()).toBe("")
    })

    test("round-trips state through serialize → parse", () => {
        const s = { tab: "users" as const, q: "alice", realm: "" }
        expect(parseDirectoryUrl(serializeDirectoryUrl(s))).toEqual(s)
    })
})

describe("directory URL realm axis (merged Explorer)", () => {
    test("reads the realm param", () => {
        expect(parseDirectoryUrl(new URLSearchParams("realm=r/x/y")).realm).toBe("r/x/y")
    })

    test("caps an over-long realm at 200 chars", () => {
        const long = "r/" + "x".repeat(500)
        expect(parseDirectoryUrl(new URLSearchParams(`realm=${long}`)).realm.length).toBe(200)
    })

    test("emits realm only on the explorer tab", () => {
        expect(serializeDirectoryUrl({ tab: "explorer", q: "", realm: "r/x/y" }).get("realm")).toBe("r/x/y")
        // A stray realm on a non-explorer tab is dropped (keeps other URLs clean).
        expect(serializeDirectoryUrl({ tab: "packages", q: "", realm: "r/x/y" }).get("realm")).toBeNull()
    })

    test("round-trips an explorer view through serialize → parse", () => {
        const s = { tab: "explorer" as const, q: "", realm: "r/samcrew/memba_feed_v1" }
        expect(parseDirectoryUrl(serializeDirectoryUrl(s))).toEqual(s)
    })
})

describe("resolveActiveTab (explorer gating fallback)", () => {
    test("explorer tab renders as explorer when the flag is ON", () => {
        expect(resolveActiveTab("explorer", true)).toBe("explorer")
    })
    test("explorer tab falls back to the default tab when the flag is OFF", () => {
        // Deep-link to ?tab=explorer with VITE_ENABLE_EXPLORER off must not leave a
        // dead nav button or a blank panel — it collapses to packages.
        expect(resolveActiveTab("explorer", false)).toBe(DEFAULT_DIRECTORY_TAB)
    })
    test("non-explorer tabs are unaffected by the flag", () => {
        for (const t of DIRECTORY_TAB_KEYS.filter(k => k !== "explorer")) {
            expect(resolveActiveTab(t, false)).toBe(t)
            expect(resolveActiveTab(t, true)).toBe(t)
        }
    })
})
