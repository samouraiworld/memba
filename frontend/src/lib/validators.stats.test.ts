/**
 * Tests for countValidatorTotals — fixes the Directory "VALIDATORS 0" banner.
 *
 * gno's tm2 `/validators` response does NOT include a `total` field, so the
 * count must come from the `validators` array length. Fixtures use the real
 * test13 shape (5 validators, voting_power "10", no `total`).
 */
import { describe, test, expect } from "vitest"
import { countValidatorTotals } from "./validators"

describe("countValidatorTotals", () => {
    test("counts the validators array when no `total` field is present (real test13 shape)", () => {
        const body = {
            block_height: "435604",
            validators: [
                { address: "g1a", pub_key: { "@type": "/tm.PubKeyEd25519", value: "a" }, voting_power: "10", proposer_priority: "0" },
                { address: "g1b", pub_key: { "@type": "/tm.PubKeyEd25519", value: "b" }, voting_power: "10", proposer_priority: "0" },
                { address: "g1c", pub_key: { "@type": "/tm.PubKeyEd25519", value: "c" }, voting_power: "10", proposer_priority: "0" },
                { address: "g1d", pub_key: { "@type": "/tm.PubKeyEd25519", value: "d" }, voting_power: "10", proposer_priority: "0" },
                { address: "g1e", pub_key: { "@type": "/tm.PubKeyEd25519", value: "e" }, voting_power: "10", proposer_priority: "0" },
            ],
        }
        const r = countValidatorTotals(body)
        expect(r.count).toBe(5)
        expect(r.votingPower).toBe(50)
    })

    test("prefers an explicit `total` when a node provides one (CometBFT-style)", () => {
        const body = { total: "7", validators: [{ voting_power: "10" }] }
        expect(countValidatorTotals(body).count).toBe(7)
    })

    test("ignores a zero or non-numeric `total` and falls back to array length", () => {
        expect(countValidatorTotals({ total: "0", validators: [{ voting_power: "1" }, { voting_power: "1" }] }).count).toBe(2)
        expect(countValidatorTotals({ total: "abc", validators: [{ voting_power: "1" }] }).count).toBe(1)
    })

    test("returns 0 for an empty or malformed result (never NaN)", () => {
        expect(countValidatorTotals({ validators: [] }).count).toBe(0)
        expect(countValidatorTotals({}).count).toBe(0)
        expect(countValidatorTotals(null).count).toBe(0)
        expect(countValidatorTotals(undefined).votingPower).toBe(0)
    })
})
