/**
 * directory.test — Tests for directory data layer.
 *
 * Verifies:
 * - Token registry parsing from GRC20 Render output
 * - User registry parsing from users Render output
 * - DAO deduplication (seeds + saved)
 * - sessionStorage caching logic
 */

import { describe, test, expect, beforeEach } from "vitest"
import {
    parseTokenRegistry,
    parseUserRegistry,
    getDirectoryDAOs,
    SEED_DAOS,
} from "./directory"

// ── Token Registry Parsing ───────────────────────────────────

describe("parseTokenRegistry", () => {
    test("parses standard table format", () => {
        const raw = [
            "| slug | name | symbol | path |",
            "|------|------|--------|------|",
            "| foo | FooToken | FOO | gno.land/r/demo/foo |",
            "| bar | BarToken | BAR | [gno.land/r/demo/bar](/r/demo/bar) |",
        ].join("\n")

        const tokens = parseTokenRegistry(raw)
        expect(tokens).toHaveLength(2)
        expect(tokens[0]).toEqual({
            slug: "foo",
            name: "FooToken",
            symbol: "FOO",
            path: "gno.land/r/demo/foo",
        })
        // Extracts path from markdown link
        expect(tokens[1].path).toBe("/r/demo/bar")
    })

    test("returns empty for no data", () => {
        expect(parseTokenRegistry("")).toHaveLength(0)
        expect(parseTokenRegistry("no table here")).toHaveLength(0)
    })

    test("skips header row", () => {
        const raw = "| slug | name | symbol | path |\n|---|---|---|---|"
        expect(parseTokenRegistry(raw)).toHaveLength(0)
    })

    test("skips rows with insufficient columns", () => {
        const raw = "| only | two |"
        expect(parseTokenRegistry(raw)).toHaveLength(0)
    })

    test("handles extra columns gracefully", () => {
        const raw = "| abc1 | Token1 | TK1 | gno.land/r/demo/tk1 | extra |"
        const tokens = parseTokenRegistry(raw)
        expect(tokens).toHaveLength(1)
        expect(tokens[0].symbol).toBe("TK1")
    })
})

// ── User Registry Parsing ────────────────────────────────────

describe("parseUserRegistry", () => {
    test("parses markdown link format", () => {
        const raw = "* [alice](https://gno.land/r/users:alice) - g1alice123456789"
        const users = parseUserRegistry(raw)
        expect(users).toHaveLength(1)
        expect(users[0]).toEqual({
            name: "alice",
            address: "g1alice123456789",
        })
    })

    test("parses simple format", () => {
        const raw = "* bob g1bob987654321"
        const users = parseUserRegistry(raw)
        expect(users).toHaveLength(1)
        expect(users[0]).toEqual({ name: "bob", address: "g1bob987654321" })
    })

    test("ignores non-user lines", () => {
        const raw = [
            "# User Registry",
            "Some description line",
            "* [alice](link) - g1alice123",
            "---",
            "* charlie g1charlie789",
        ].join("\n")

        const users = parseUserRegistry(raw)
        expect(users).toHaveLength(2)
    })

    test("returns empty for no matching lines", () => {
        expect(parseUserRegistry("")).toHaveLength(0)
        expect(parseUserRegistry("no users here")).toHaveLength(0)
    })

    test("does not match non-g1 addresses in simple format", () => {
        const raw = "* bob 0x1234567890"
        expect(parseUserRegistry(raw)).toHaveLength(0)
    })
})

// ── DAO Deduplication ────────────────────────────────────────

describe("getDirectoryDAOs", () => {
    beforeEach(() => {
        localStorage.clear()
    })

    test("returns seed DAOs when no saved DAOs", () => {
        const daos = getDirectoryDAOs()
        expect(daos).toHaveLength(SEED_DAOS.length)
        expect(daos[0].name).toBe("GovDAO")
        expect(daos[0].isSaved).toBe(false)
    })

    test("deduplicates saved DAOs matching seeds", () => {
        // Save GovDAO (which is also a seed)
        localStorage.setItem("memba_saved_daos", JSON.stringify([
            { realmPath: "gno.land/r/gov/dao", name: "GovDAO", addedAt: Date.now() },
        ]))

        const daos = getDirectoryDAOs()
        // Should not have duplicates — GovDAO should appear once, marked as saved
        const govDaos = daos.filter(d => d.path === "gno.land/r/gov/dao")
        expect(govDaos).toHaveLength(1)
        expect(govDaos[0].isSaved).toBe(true)
    })

    test("includes extra saved DAOs beyond seeds", () => {
        localStorage.setItem("memba_saved_daos", JSON.stringify([
            { realmPath: "gno.land/r/custom/dao", name: "Custom DAO", addedAt: Date.now() },
        ]))

        const daos = getDirectoryDAOs()
        expect(daos).toHaveLength(SEED_DAOS.length + 1)
        const custom = daos.find(d => d.path === "gno.land/r/custom/dao")
        expect(custom).toBeDefined()
        expect(custom!.isSaved).toBe(true)
    })
})
