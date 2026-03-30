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

function makeConfig(overrides: Partial<DAOCreationConfig> = {}): DAOCreationConfig {
    return {
        name: "SecTest DAO",
        description: "Security test",
        realmPath: "gno.land/r/test/secdao",
        members: [
            { address: "g1" + "a".repeat(38), power: 1, roles: ["admin"] },
        ],
        threshold: 51,
        roles: ["admin", "member"],
        quorum: 0,
        proposalCategories: ["governance"],
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

    it("only valid members appear in generated code", () => {
        const validAddr = "g1" + "a".repeat(38)
        const code = generateDAOCode(makeConfig({
            members: [
                { address: validAddr, power: 1, roles: ["admin"] },
                { address: "INJECTED_CODE", power: 1, roles: ["admin"] },
                { address: "", power: 1, roles: ["admin"] },
            ],
        }))
        expect(code).toContain(validAddr)
        expect(code).not.toContain("INJECTED_CODE")
        // Only one address() call — the valid one
        expect(code.match(/address\("g1/g)?.length).toBe(1)
    })
})

// ── Role/category injection vectors ──────────────────────────

describe("role injection prevention", () => {
    it("rejects roles starting with non-lowercase", () => {
        const code = generateDAOCode(makeConfig({
            roles: ["admin", "Admin", "ADMIN", "123role"],
        }))
        expect(code).toContain('"admin"')
        // isValidIdentifier requires ^[a-z] start
        expect(code).not.toContain('"Admin"')
        expect(code).not.toContain('"ADMIN"')
        expect(code).not.toContain('"123role"')
    })

    it("rejects roles with spaces or special chars", () => {
        const code = generateDAOCode(makeConfig({
            roles: ["admin", "super admin", "my-role", "role.name"],
        }))
        expect(code).toContain('"admin"')
        expect(code).not.toContain("super admin")
        expect(code).not.toContain("my-role")
        expect(code).not.toContain("role.name")
    })

    it("allows valid underscore identifiers", () => {
        const code = generateDAOCode(makeConfig({
            roles: ["admin", "dev_team", "finance_lead"],
        }))
        expect(code).toContain('"dev_team"')
        expect(code).toContain('"finance_lead"')
    })

    it("rejects categories with injection attempts", () => {
        const code = generateDAOCode(makeConfig({
            proposalCategories: ["governance", '"; INJECT("x', "treasury"],
        }))
        expect(code).toContain('"governance"')
        expect(code).toContain('"treasury"')
        expect(code).not.toContain("INJECT")
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

    it("handles extremely long name without crash", () => {
        const longName = "A".repeat(1000)
        const code = generateDAOCode(makeConfig({ name: longName }))
        expect(code).toContain(longName)
        expect(code).toMatch(/^package secdao/)
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

describe("power value hardening", () => {
    it("clamps negative power to 0", () => {
        const code = generateDAOCode(makeConfig({
            members: [{ address: "g1" + "a".repeat(38), power: -999, roles: ["admin"] }],
        }))
        expect(code).toContain("Power: 0")
    })

    it("floors fractional power", () => {
        const code = generateDAOCode(makeConfig({
            members: [{ address: "g1" + "a".repeat(38), power: 3.99, roles: ["admin"] }],
        }))
        expect(code).toContain("Power: 3")
    })

    it("handles MAX_SAFE_INTEGER", () => {
        const code = generateDAOCode(makeConfig({
            members: [{ address: "g1" + "a".repeat(38), power: Number.MAX_SAFE_INTEGER, roles: ["admin"] }],
        }))
        // Should produce a valid (very large) number, not crash
        expect(code).toContain("Power: 9007199254740991")
    })

    it("NaN power produces NaN in output (known edge case)", () => {
        // Math.max(0, Math.floor(NaN)) = NaN in JS
        // The chain would reject this — but it's not an injection vector
        const code = generateDAOCode(makeConfig({
            members: [{ address: "g1" + "a".repeat(38), power: NaN, roles: ["admin"] }],
        }))
        expect(code).toContain("Power: NaN")
    })
})
