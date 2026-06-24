import { describe, it, expect } from "vitest"
import { daoStepError, type DAOStepData } from "./daoTemplate"

// A syntactically valid g1 address: starts with the bech32 prefix, length >= 39.
const validAddr = "g1" + "a".repeat(38)

const base: DAOStepData = {
    name: "My DAO",
    realmPath: `gno.land/r/${validAddr}/mydao`,
    members: [{ address: validAddr, roles: ["admin"] }],
    threshold: 51,
    quorum: 0,
}

describe("daoStepError — pure wizard step validation", () => {
    it("step 1: rejects an empty name", () => {
        expect(daoStepError(1, { ...base, name: "" })).toBe("DAO name is required")
    })

    it("step 1: rejects a name shorter than 3 characters", () => {
        expect(daoStepError(1, { ...base, name: "ab" })).toBe(
            "DAO name must be at least 3 characters",
        )
    })

    it("step 1: rejects an empty realm path", () => {
        expect(daoStepError(1, { ...base, realmPath: "" })).toBe("Realm path is required")
    })

    it("step 2: rejects when there is no valid member address", () => {
        expect(
            daoStepError(2, { ...base, members: [{ address: "", roles: ["admin"] }] }),
        ).toBe("At least one member with a valid g1 address is required")
    })

    it("step 2: rejects when no member has the admin role", () => {
        expect(
            daoStepError(2, { ...base, members: [{ address: validAddr, roles: ["member"] }] }),
        ).toBe("At least one member must have the admin role")
    })

    it("step 3: rejects an out-of-range threshold", () => {
        expect(daoStepError(3, { ...base, threshold: 0 })).toBe(
            "Threshold must be between 1 and 100",
        )
    })

    it("step 3: returns null for valid threshold/quorum", () => {
        expect(daoStepError(3, { ...base, threshold: 51, quorum: 40 })).toBeNull()
    })

    it("returns null for steps without validation (e.g. 4)", () => {
        expect(daoStepError(4, base)).toBeNull()
    })
})
