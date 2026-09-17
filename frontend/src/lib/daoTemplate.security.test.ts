/**
 * Security-focused tests for DAO template code generation.
 *
 * Validates whitelist validation against adversarial inputs:
 * - Code injection via member addresses, roles, categories, names
 * - Path traversal via realm paths
 * - Integer overflow / underflow in power values
 * - Unicode and control character injection
 *
 * @module lib/daoTemplate.security.test
 */
import { describe, it, expect } from "vitest"
import {
    generateDAOCode,
    validateRealmPath,
    isValidGnoAddress,
    type DAOCreationConfig,
} from "./daoTemplate"

// A checksummed address: the v2 generator verifies the bech32 checksum.
const MEMBER = "g1747t5m2f08plqjlrjk2q0qld7465hxz8gkx59c"

function makeConfig(overrides: Partial<DAOCreationConfig> = {}): DAOCreationConfig {
    return {
        name: "SecTest DAO",
        description: "Security test",
        realmPath: "gno.land/r/test/secdao",
        members: [
            { address: MEMBER, power: 1, roles: ["admin"] },
        ],
        threshold: 51,
        roles: ["admin", "member"],
        quorum: 0,
        proposalCategories: ["governance"],
        votingPeriodSeconds: 86400,
        executionDelaySeconds: 3600,
        executionWindowSeconds: 86400,
        ...overrides,
    }
}

// ── Address injection vectors ────────────────────────────────

describe("address injection prevention", () => {
    it("rejects address with Gno code injection", () => {
        expect(isValidGnoAddress('g1"); panic("pwned"); //')).toBe(false)
    })

    it("rejects address with backtick injection", () => {
        expect(isValidGnoAddress("g1`+malicious_func()+`aaaaaaaaaaaaaaa")).toBe(false)
    })

    it("rejects address with null bytes", () => {
        expect(isValidGnoAddress("g1\x00" + "a".repeat(37))).toBe(false)
    })

    it("rejects address with unicode lookalikes", () => {
        expect(isValidGnoAddress("g1\u0430" + "a".repeat(37))).toBe(false)
    })

    it("refuses the entire roster rather than dropping invalid members", () => {
        expect(() => generateDAOCode(makeConfig({ members: [
            { address: MEMBER, power: 1, roles: ["admin"] },
            { address: "INJECTED_CODE", power: 1, roles: ["admin"] },
            { address: "", power: 1, roles: ["admin"] },
        ] }))).toThrow(/address/i)
    })
})

// ── Role/category injection vectors ──────────────────────────

describe("role injection prevention", () => {
    it("rejects roles starting with non-lowercase", () => {
        expect(() => generateDAOCode(makeConfig({ roles: ["admin", "Admin", "ADMIN", "123role"] }))).toThrow(/role/i)
    })

    it("rejects roles with spaces or special chars", () => {
        expect(() => generateDAOCode(makeConfig({ roles: ["admin", "super admin", "my-role", "role.name"] }))).toThrow(/role/i)
    })

    it("allows valid underscore identifiers", () => {
        const code = generateDAOCode(makeConfig({
            roles: ["admin", "dev_team", "finance_lead"],
        }))
        expect(code).toContain('"dev_team"')
        expect(code).toContain('"finance_lead"')
    })

    it("rejects categories with injection attempts", () => {
        expect(() => generateDAOCode(makeConfig({ proposalCategories: ["governance", '"; INJECT("x', "treasury"] }))).toThrow(/categor/i)
    })
})

// ── Name/description injection ───────────────────────────────

describe("name/description injection prevention", () => {
    it("JSON.stringify escapes quotes in DAO name", () => {
        const code = generateDAOCode(makeConfig({ name: 'My "Evil" DAO' }))
        // The generated Go string should have escaped quotes
        expect(code).toContain('\\"Evil\\"')
    })

    it("JSON.stringify escapes backslashes in description", () => {
        const code = generateDAOCode(makeConfig({ description: "path\\to\\exploit" }))
        expect(code).toContain("\\\\")
    })

    it("handles template literal injection in description", () => {
        const code = generateDAOCode(makeConfig({ description: "${process.exit(1)}" }))
        // Present as string content, not executable
        expect(code).toMatch(/description\s+=\s+".*process/)
    })

    // v2: names are capped at 64 characters instead of being accepted at any length.
    it("refuses an extremely long name instead of writing it into the realm", () => {
        expect(() => generateDAOCode(makeConfig({ name: "A".repeat(1000) }))).toThrow(/at most 64/)
        expect(generateDAOCode(makeConfig({ name: "A".repeat(64) }))).toMatch(/^package secdao/)
    })
})

// ── Realm path traversal ─────────────────────────────────────

describe("realm path security", () => {
    it("rejects path traversal", () => {
        expect(validateRealmPath("gno.land/r/../../../etc/passwd")).not.toBeNull()
    })

    it("rejects path with double dots in segment", () => {
        expect(validateRealmPath("gno.land/r/user/..dao")).not.toBeNull()
    })

    it("rejects path with encoded characters", () => {
        expect(validateRealmPath("gno.land/r/user/%2e%2e")).not.toBeNull()
    })

    it("rejects path with null bytes", () => {
        expect(validateRealmPath("gno.land/r/user/dao\x00evil")).not.toBeNull()
    })
})

// ── Power value edge cases ───────────────────────────────────
// W1.1: silent clamp/floor replaced by fail-closed throws — a wrong power in
// an immutable realm is worse than a rejected wizard step.

describe("power value hardening", () => {
    it("throws on negative power (was silently clamped to 0)", () => {
        expect(() => generateDAOCode(makeConfig({
            members: [{ address: MEMBER, power: -999, roles: ["admin"] }],
        }))).toThrow(/power/i)
    })

    it("throws on fractional power (was silently floored)", () => {
        expect(() => generateDAOCode(makeConfig({
            members: [{ address: MEMBER, power: 3.99, roles: ["admin"] }],
        }))).toThrow(/power/i)
    })

    it("throws on MAX_SAFE_INTEGER power (exceeds the 1e9 bound)", () => {
        expect(() => generateDAOCode(makeConfig({
            members: [{ address: MEMBER, power: Number.MAX_SAFE_INTEGER, roles: ["admin"] }],
        }))).toThrow(/power/i)
    })

    it("throws on NaN power (was interpolated as literal NaN)", () => {
        expect(() => generateDAOCode(makeConfig({
            members: [{ address: MEMBER, power: NaN, roles: ["admin"] }],
        }))).toThrow(/power/i)
    })

    it("boundary powers still generate", () => {
        const code = generateDAOCode(makeConfig({
            members: [{ address: MEMBER, power: 1_000_000_000, roles: ["admin"] }],
        }))
        expect(code).toContain(`addGenesisMember("${MEMBER}", 1000000000, []string{"admin"})`)
    })
})
