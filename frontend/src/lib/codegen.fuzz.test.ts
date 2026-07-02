/**
 * Property-based fuzzing for the Gno codegen fail-closed guards (W1.1).
 *
 * Invariants, for every generator: ∀ valid config ⇒ code generates with the
 * value interpolated exactly; ∀ invalid numeric/string input ⇒ THROWS before
 * any interpolation. Generated realms are immutable on deploy, so "reject at
 * codegen" is the last line of defense against bypassed wizard validation.
 */

import { describe, it, expect } from "vitest"
import fc from "fast-check"
import { generateDAOCode, type DAOCreationConfig } from "./daoTemplate"
import { generateEscrowCode, type EscrowConfig } from "./escrowTemplate"
import { generateAgentRegistryCode, type AgentRegistryConfig } from "./agentTemplate"
import { generateChannelCode, defaultChannelConfig } from "./channelTemplate"

const RUNS = { numRuns: 50 }

function daoConfig(overrides: Partial<DAOCreationConfig> = {}): DAOCreationConfig {
    return {
        name: "Fuzz DAO",
        description: "fuzz",
        realmPath: "gno.land/r/test/fuzzdao",
        members: [{ address: "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5", power: 1, roles: ["admin"] }],
        threshold: 51,
        roles: ["admin"],
        quorum: 0,
        proposalCategories: ["governance"],
        votingPeriodBlocks: 151200,
        ...overrides,
    }
}

const escrowConfig = (overrides: Partial<EscrowConfig> = {}): EscrowConfig => ({
    realmPath: "gno.land/r/test/fuzzescrow",
    adminAddress: "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5",
    platformFeePercent: 2,
    cancellationFeePercent: 5,
    autoRefundBlocks: 864000,
    feeRecipient: "g1u7y667z64x2h7vc6fmpcprgey4ck233jaww9zq",
    ...overrides,
})

const agentConfig = (overrides: Partial<AgentRegistryConfig> = {}): AgentRegistryConfig => ({
    realmPath: "gno.land/r/test/fuzzagents",
    name: "Fuzz Registry",
    description: "fuzz",
    adminAddress: "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5",
    ...overrides,
})

describe("DAO codegen — fast-check properties (W1.1)", () => {
    it("∀ threshold ∈ [1,100] ∧ quorum ∈ [0,100] ⇒ generates with exact values, no NaN", () => {
        fc.assert(
            fc.property(fc.integer({ min: 1, max: 100 }), fc.integer({ min: 0, max: 100 }), (threshold, quorum) => {
                const code = generateDAOCode(daoConfig({ threshold, quorum }))
                expect(code).toContain(`threshold         = ${threshold}`)
                expect(code).toContain(`quorum            = ${quorum}`)
                expect(code).not.toContain("NaN")
                expect(code).not.toContain("undefined")
            }),
            RUNS,
        )
    })
    it("∀ threshold ∉ [1,100] (or non-integer) ⇒ throws", () => {
        fc.assert(
            fc.property(
                fc.oneof(
                    fc.integer({ max: 0 }),
                    fc.integer({ min: 101 }),
                    fc.double({ noInteger: true, noNaN: false, noDefaultInfinity: false }),
                ),
                (threshold) => {
                    expect(() => generateDAOCode(daoConfig({ threshold }))).toThrow()
                },
            ),
            RUNS,
        )
    })
})

describe("Escrow codegen — fast-check properties (W1.1)", () => {
    it("∀ fees within documented bounds ⇒ generates with exact values", () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 0, max: 5 }),
                fc.integer({ min: 0, max: 10 }),
                fc.integer({ min: 1, max: 1_000_000_000 }),
                (platformFeePercent, cancellationFeePercent, autoRefundBlocks) => {
                    const code = generateEscrowCode(escrowConfig({ platformFeePercent, cancellationFeePercent, autoRefundBlocks }))
                    expect(code).toContain(`PlatformFee        = ${platformFeePercent}`)
                    expect(code).toContain(`CancellationFee    = ${cancellationFeePercent}`)
                    expect(code).not.toContain("NaN")
                },
            ),
            RUNS,
        )
    })
    it("∀ platform fee outside [0,5] ⇒ throws (fee spine of an immutable money realm)", () => {
        fc.assert(
            fc.property(
                fc.oneof(fc.integer({ max: -1 }), fc.integer({ min: 6 }), fc.constant(NaN)),
                (platformFeePercent) => {
                    expect(() => generateEscrowCode(escrowConfig({ platformFeePercent }))).toThrow()
                },
            ),
            RUNS,
        )
    })
})

describe("Agent codegen — fast-check properties (W1.1 comment injection)", () => {
    it("∀ unicode name ⇒ the header stays inside comments (no breakout line)", () => {
        fc.assert(
            fc.property(fc.string({ maxLength: 200, unit: "binary" }), (name) => {
                const code = generateAgentRegistryCode(agentConfig({ name }))
                // Lines 2-7 form the generated header block: every non-empty
                // line must still be a comment — no injected statement lines.
                for (const line of code.split("\n").slice(1, 7)) {
                    if (line.trim() !== "") expect(line.trimStart().startsWith("//")).toBe(true)
                }
            }),
            RUNS,
        )
    })
})

describe("Channel codegen — fast-check properties (W1.1 token gate)", () => {
    it("∀ non-ticker tokenSymbol with an active gate ⇒ throws", () => {
        fc.assert(
            fc.property(
                fc.string({ minLength: 1, maxLength: 30 }).filter((s) => !/^[A-Z][A-Z0-9]{1,9}$/.test(s)),
                (tokenSymbol) => {
                    const cfg = { ...defaultChannelConfig("gno.land/r/test/fuzzdao", "Fuzz"), minTokenBalance: 100, tokenSymbol }
                    expect(() => generateChannelCode(cfg)).toThrow(/tokenSymbol/i)
                },
            ),
            RUNS,
        )
    })
})
