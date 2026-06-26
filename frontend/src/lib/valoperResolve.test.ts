import { describe, it, expect } from "vitest"
import { resolveValidatorProfile } from "./valopers"
import type { ValoperWithStatus } from "./valopers"

/**
 * The unified validator profile is reached by ONE canonical route /validators/:address,
 * but addresses come from two spaces:
 *   - operator address  (a valoper's stable identity, the canonical key)
 *   - signing address    (the consensus/gnoAddr a validator signs with)
 * and the two populations are largely disjoint on test13 (genesis validators have no
 * valoper record; most valopers are candidates). resolveValidatorProfile() classifies an
 * incoming address into one of three identity cases + a redirect decision.
 */

const valoper = (over: Partial<ValoperWithStatus>): ValoperWithStatus => ({
    moniker: "Test",
    description: "",
    operatorAddress: "g1operatorAAA",
    signingAddress: "g1signAAA",
    signingPubKey: "gpub1aaa",
    serverType: "cloud",
    status: "candidate",
    ...over,
})

describe("resolveValidatorProfile", () => {
    it("operator address of an ACTIVE valoper → registered-active, canonical, no redirect", () => {
        const v = valoper({ operatorAddress: "g1op1", signingAddress: "g1sign1", status: "active" })
        const r = resolveValidatorProfile("g1op1", [v], new Set(["g1sign1"]))
        expect(r.identityCase).toBe("registered-active")
        expect(r.canonicalAddress).toBe("g1op1")
        expect(r.shouldRedirect).toBe(false)
        expect(r.valoper).toBe(v)
        expect(r.performanceAddress).toBe("g1sign1")
        expect(r.isActive).toBe(true)
    })

    it("operator address of a CANDIDATE valoper → registered-candidate, no redirect, inactive", () => {
        const v = valoper({ operatorAddress: "g1op2", signingAddress: "g1sign2", status: "candidate" })
        const r = resolveValidatorProfile("g1op2", [v], new Set(["g1otherActive"]))
        expect(r.identityCase).toBe("registered-candidate")
        expect(r.canonicalAddress).toBe("g1op2")
        expect(r.shouldRedirect).toBe(false)
        expect(r.isActive).toBe(false)
    })

    it("SIGNING address of a registered valoper → redirects to the operator address", () => {
        const v = valoper({ operatorAddress: "g1op3", signingAddress: "g1sign3", status: "active" })
        const r = resolveValidatorProfile("g1sign3", [v], new Set(["g1sign3"]))
        expect(r.canonicalAddress).toBe("g1op3")
        expect(r.shouldRedirect).toBe(true)
        expect(r.identityCase).toBe("registered-active")
        expect(r.valoper).toBe(v)
    })

    it("active-set address with NO valoper record → genesis, canonical (no redirect), active", () => {
        const v = valoper({ operatorAddress: "g1op4", signingAddress: "g1sign4" })
        const r = resolveValidatorProfile("g1genesis", [v], new Set(["g1genesis", "g1sign4"]))
        expect(r.identityCase).toBe("genesis")
        expect(r.canonicalAddress).toBe("g1genesis")
        expect(r.shouldRedirect).toBe(false)
        expect(r.valoper).toBeNull()
        expect(r.performanceAddress).toBe("g1genesis")
        expect(r.isActive).toBe(true)
    })

    it("unknown address → not-found, no redirect", () => {
        const r = resolveValidatorProfile("g1nope", [valoper({})], new Set(["g1sign4"]))
        expect(r.identityCase).toBe("not-found")
        expect(r.shouldRedirect).toBe(false)
        expect(r.valoper).toBeNull()
    })

    it("empty / undefined address → not-found, never redirects (no loop)", () => {
        const r = resolveValidatorProfile(undefined, [valoper({})], new Set())
        expect(r.identityCase).toBe("not-found")
        expect(r.shouldRedirect).toBe(false)
    })
})
