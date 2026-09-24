import { describe, expect, it } from "vitest"
import { assertOsFlagAllowed, OS_BETA_SITE, OS_FLAG } from "./osBuildGate"

describe("assertOsFlagAllowed", () => {
    it("allows builds with the flag off or unset", () => {
        expect(() => assertOsFlagAllowed({})).not.toThrow()
        expect(() => assertOsFlagAllowed({ [OS_FLAG]: "false" })).not.toThrow()
        expect(() => assertOsFlagAllowed({ [OS_FLAG]: "" })).not.toThrow()
    })

    it("fails a build that turns Memba OS on without the beta-site opt-in", () => {
        expect(() => assertOsFlagAllowed({ [OS_FLAG]: "true" })).toThrow(/MEMBA OS GATE FAILED/)
        expect(() => assertOsFlagAllowed({ [OS_FLAG]: "true", [OS_BETA_SITE]: "false" })).toThrow()
        expect(() => assertOsFlagAllowed({ [OS_FLAG]: "true", [OS_BETA_SITE]: "1" })).toThrow()
    })

    it("allows the beta site, which opts in explicitly", () => {
        expect(() => assertOsFlagAllowed({ [OS_FLAG]: "true", [OS_BETA_SITE]: "true" })).not.toThrow()
    })

    it("names both variables in the error so the fix is obvious", () => {
        expect(() => assertOsFlagAllowed({ [OS_FLAG]: "true" })).toThrow(new RegExp(`${OS_FLAG}.*${OS_BETA_SITE}`))
    })
})
