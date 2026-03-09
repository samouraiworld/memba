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
    getDAOCategory,
    getActivityLevel,
    parseDAOMemberAddresses,
    calculateContributionScores,
    getDiscoveryProbes,
    addDiscoveryProbe,
    fetchPackages,
    fetchRealms,
    SEED_DAOS,
    SEED_PACKAGES,
    SEED_REALMS,
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

    test("all DAOs have a category field", () => {
        const daos = getDirectoryDAOs()
        for (const dao of daos) {
            expect(dao).toHaveProperty("category")
            expect(typeof dao.category).toBe("string")
        }
    })
})

// ── DAO Category Heuristic ───────────────────────────────────

describe("getDAOCategory", () => {
    test("classifies governance DAOs by path", () => {
        expect(getDAOCategory("gno.land/r/gov/dao", "GovDAO")).toBe("governance")
        expect(getDAOCategory("gno.land/r/gov_v2/dao", "DAO")).toBe("governance")
    })

    test("classifies governance by name", () => {
        expect(getDAOCategory("gno.land/r/test/council", "Council DAO")).toBe("governance")
        expect(getDAOCategory("gno.land/r/test/x", "Senate")).toBe("governance")
    })

    test("classifies community DAOs", () => {
        expect(getDAOCategory("gno.land/r/demo/worx", "Worx DAO")).toBe("community")
        expect(getDAOCategory("gno.land/r/demo/test", "Test")).toBe("community")
    })

    test("classifies treasury DAOs", () => {
        expect(getDAOCategory("gno.land/r/treasury", "Treasury")).toBe("treasury")
        expect(getDAOCategory("gno.land/r/test/x", "Fund DAO")).toBe("treasury")
    })

    test("classifies DeFi DAOs", () => {
        expect(getDAOCategory("gno.land/r/swap/pool", "SwapPool")).toBe("defi")
        expect(getDAOCategory("gno.land/r/test/x", "Liquidity DAO")).toBe("defi")
    })

    test("classifies infrastructure DAOs", () => {
        expect(getDAOCategory("gno.land/r/infra/x", "Infra DAO")).toBe("infrastructure")
        expect(getDAOCategory("gno.land/r/test/y", "Validator Set")).toBe("infrastructure")
    })

    test("returns unknown for unrecognized DAOs", () => {
        expect(getDAOCategory("gno.land/r/some/thing", "Random DAO")).toBe("unknown")
    })

    test("governance takes priority over community for /demo/ gov DAOs", () => {
        expect(getDAOCategory("gno.land/r/demo/gov", "Gov Test")).toBe("governance")
    })

    test("case insensitive matching", () => {
        expect(getDAOCategory("gno.land/r/GOV/dao", "GOVDAO")).toBe("governance")
    })

    // I3 regression: word-boundary prevents false positives
    test("does NOT match 'node' inside other words (I3 fix)", () => {
        expect(getDAOCategory("gno.land/r/test/x", "AntiNode DAO")).toBe("unknown")
        expect(getDAOCategory("gno.land/r/test/x", "Nodemon")).toBe("unknown")
    })

    test("does NOT match 'pool' inside other words (I3 fix)", () => {
        expect(getDAOCategory("gno.land/r/test/x", "Carpool Group")).toBe("unknown")
        expect(getDAOCategory("gno.land/r/test/x", "Liverpool DAO")).toBe("unknown")
    })

    test("matches 'node' as a standalone word", () => {
        expect(getDAOCategory("gno.land/r/test/x", "Node Operators")).toBe("infrastructure")
        expect(getDAOCategory("gno.land/r/test/x", "node-dao")).toBe("infrastructure")
    })
})

// ── Discovery Probe API (I2 fix) ───────────────────────────

describe("Discovery Probe API", () => {
    test("getDiscoveryProbes returns default probes", () => {
        const probes = getDiscoveryProbes()
        expect(probes.length).toBeGreaterThanOrEqual(2)
        expect(probes.some(p => p.path === "gno.land/r/gov/dao")).toBe(true)
    })

    test("addDiscoveryProbe adds new probe", () => {
        const before = getDiscoveryProbes().length
        addDiscoveryProbe("Test DAO", "gno.land/r/test/unique-probe")
        const after = getDiscoveryProbes()
        expect(after.length).toBe(before + 1)
        expect(after.some(p => p.path === "gno.land/r/test/unique-probe")).toBe(true)
    })

    test("addDiscoveryProbe deduplicates by path", () => {
        const before = getDiscoveryProbes().length
        addDiscoveryProbe("Duplicate", "gno.land/r/gov/dao") // already exists
        expect(getDiscoveryProbes().length).toBe(before)
    })
})

// ── Contribution Scoring ───────────────────────────────────

describe("getActivityLevel", () => {
    test("active for 3+ DAOs", () => {
        expect(getActivityLevel(3)).toBe("active")
        expect(getActivityLevel(5)).toBe("active")
    })

    test("moderate for 2 DAOs", () => {
        expect(getActivityLevel(2)).toBe("moderate")
    })

    test("newcomer for 1 DAO", () => {
        expect(getActivityLevel(1)).toBe("newcomer")
    })

    test("observer for 0 DAOs", () => {
        expect(getActivityLevel(0)).toBe("observer")
    })
})

describe("parseDAOMemberAddresses", () => {
    test("extracts g1 addresses from Render output", () => {
        const raw = "Members:\n- g1abcdefghij1234567890abcdefghij12345678 (admin)\n- g1zyxwvutsrq9876543210zyxwvutsrq98765432 (member)"
        const addrs = parseDAOMemberAddresses(raw)
        expect(addrs).toHaveLength(2)
        expect(addrs[0]).toMatch(/^g1/)
    })

    test("deduplicates addresses", () => {
        const raw = "g1abcdefghij1234567890abcdefghij12345678 voted YES\ng1abcdefghij1234567890abcdefghij12345678 proposed"
        const addrs = parseDAOMemberAddresses(raw)
        expect(addrs).toHaveLength(1)
    })

    test("returns empty for no addresses", () => {
        expect(parseDAOMemberAddresses("no addresses here")).toHaveLength(0)
    })
})

describe("calculateContributionScores", () => {
    test("counts DAO memberships per user", () => {
        const users = [
            { name: "alice", address: "g1abcdefghij1234567890abcdefghij12345678" },
            { name: "bob", address: "g1zyxwvutsrq9876543210zyxwvutsrq98765432" },
        ]
        const memberMap = new Map([
            ["dao1", ["g1abcdefghij1234567890abcdefghij12345678", "g1zyxwvutsrq9876543210zyxwvutsrq98765432"]],
            ["dao2", ["g1abcdefghij1234567890abcdefghij12345678"]],
        ])

        const scores = calculateContributionScores(users, memberMap)
        expect(scores.get("g1abcdefghij1234567890abcdefghij12345678")!.daoCount).toBe(2)
        expect(scores.get("g1abcdefghij1234567890abcdefghij12345678")!.level).toBe("moderate")
        expect(scores.get("g1zyxwvutsrq9876543210zyxwvutsrq98765432")!.daoCount).toBe(1)
        expect(scores.get("g1zyxwvutsrq9876543210zyxwvutsrq98765432")!.level).toBe("newcomer")
    })

    test("returns observer for users not in any DAO", () => {
        const users = [{ name: "nobody", address: "g1nobody0000000000000000000000000000000a" }]
        const memberMap = new Map([["dao1", ["g1abcdefghij1234567890abcdefghij12345678"]]])
        const scores = calculateContributionScores(users, memberMap)
        expect(scores.get("g1nobody0000000000000000000000000000000a")!.level).toBe("observer")
    })
})

// ── Package Discovery (B2) ─────────────────────────────────

describe("fetchPackages", () => {
    test("returns all seed packages", () => {
        const packages = fetchPackages()
        expect(packages.length).toBe(SEED_PACKAGES.length)
        expect(packages.length).toBeGreaterThanOrEqual(10)
    })

    test("all packages have required fields", () => {
        for (const pkg of fetchPackages()) {
            expect(typeof pkg.name).toBe("string")
            expect(typeof pkg.path).toBe("string")
            expect(typeof pkg.description).toBe("string")
            expect(pkg.name.length).toBeGreaterThan(0)
            expect(pkg.path).toContain("gno.land/p/")
        }
    })

    test("returns a copy (not a reference to the seed array)", () => {
        const a = fetchPackages()
        const b = fetchPackages()
        expect(a).not.toBe(b)
        expect(a).toEqual(b)
    })

    test("includes well-known packages", () => {
        const packages = fetchPackages()
        const names = packages.map(p => p.name)
        expect(names).toContain("GRC20")
        expect(names).toContain("AVL Tree")
        expect(names).toContain("DAO")
    })
})

// ── Realm Discovery (B2) ───────────────────────────────────

describe("fetchRealms", () => {
    beforeEach(() => {
        localStorage.clear()
    })

    test("returns at least seed realms", () => {
        const realms = fetchRealms()
        expect(realms.length).toBeGreaterThanOrEqual(SEED_REALMS.length)
    })

    test("all realms have required fields", () => {
        for (const realm of fetchRealms()) {
            expect(typeof realm.name).toBe("string")
            expect(typeof realm.path).toBe("string")
            expect(typeof realm.description).toBe("string")
            expect(typeof realm.category).toBe("string")
            expect(realm.path).toContain("gno.land/r/")
        }
    })

    test("includes well-known realms", () => {
        const realms = fetchRealms()
        const paths = realms.map(r => r.path)
        expect(paths).toContain("gno.land/r/demo/grc20reg")
        expect(paths).toContain("gno.land/r/gov/dao")
    })

    test("deduplicates DAOs already in seed realms", () => {
        // GovDAO is both a SEED_DAO and a SEED_REALM
        const realms = fetchRealms()
        const govPaths = realms.filter(r => r.path === "gno.land/r/gov/dao")
        expect(govPaths).toHaveLength(1)
    })

    test("category values are valid", () => {
        const validCategories = ["standard", "defi", "social", "utility", "game", "unknown"]
        for (const realm of fetchRealms()) {
            expect(validCategories).toContain(realm.category)
        }
    })

    test("merges saved DAOs not in seed realms", () => {
        localStorage.setItem("memba_saved_daos", JSON.stringify([
            { realmPath: "gno.land/r/custom/unique-realm-test", name: "Custom Realm", addedAt: Date.now() },
        ]))
        const realms = fetchRealms()
        const custom = realms.find(r => r.path === "gno.land/r/custom/unique-realm-test")
        expect(custom).toBeDefined()
        expect(custom!.name).toBe("Custom Realm")
    })
})

describe("SEED_PACKAGES", () => {
    test("all paths follow gno.land/p/ convention", () => {
        for (const pkg of SEED_PACKAGES) {
            expect(pkg.path).toMatch(/^gno\.land\/p\//)
        }
    })

    test("no duplicate paths", () => {
        const paths = SEED_PACKAGES.map(p => p.path)
        expect(new Set(paths).size).toBe(paths.length)
    })
})

describe("SEED_REALMS", () => {
    test("all paths follow gno.land/r/ convention", () => {
        for (const realm of SEED_REALMS) {
            expect(realm.path).toMatch(/^gno\.land\/r\//)
        }
    })

    test("no duplicate paths", () => {
        const paths = SEED_REALMS.map(r => r.path)
        expect(new Set(paths).size).toBe(paths.length)
    })
})
