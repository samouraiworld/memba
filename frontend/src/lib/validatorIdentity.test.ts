import { describe, it, expect } from "vitest"
import { resolveValidatorIdentity } from "./validatorIdentity"

describe("resolveValidatorIdentity", () => {
    it("maps a core validator moniker to its team", () => {
        expect(resolveValidatorIdentity({ moniker: "gno-core-val-01" })).toEqual({ kind: "team", slug: "all-in-bits", label: "All in Bits" })
        expect(resolveValidatorIdentity({ moniker: "samourai-crew-1" })?.slug).toBe("samouraiworld")
    })

    it("maps an individual validator moniker to its gnolove contributor login", () => {
        expect(resolveValidatorIdentity({ moniker: "aeddi-1" })).toEqual({ kind: "contributor", login: "aeddi", label: "aeddi" })
    })

    it("is case-insensitive on moniker", () => {
        expect(resolveValidatorIdentity({ moniker: "AEDDI-1" })?.kind).toBe("contributor")
    })

    it("matches by address (operator or signing), and address wins over moniker", () => {
        const r = resolveValidatorIdentity({ moniker: "unknown", addresses: ["g19rl4cm2hmr8afy4kldpxz3fka4jguq0a0u3773"] })
        expect(r).toEqual({ kind: "contributor", login: "gfanton", label: "gfanton" })
    })

    it("returns null for an unmapped validator", () => {
        expect(resolveValidatorIdentity({ moniker: "some-random-validator", addresses: ["g1nope"] })).toBeNull()
        expect(resolveValidatorIdentity({})).toBeNull()
    })
})
