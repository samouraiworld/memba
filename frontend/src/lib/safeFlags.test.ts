import { describe, it, expect } from "vitest"
import { assertSafeFlags, SAFETY_GATED_FLAGS, shouldEnforceFlagGate } from "./safeFlags"

describe("assertSafeFlags", () => {
    it("passes when no gated flag is enabled", () => {
        expect(() => assertSafeFlags({ VITE_ENABLE_NFT: "false", VITE_GNO_CHAIN_ID: "test-13" })).not.toThrow()
    })

    it("passes when gated flags are absent", () => {
        expect(() => assertSafeFlags({})).not.toThrow()
    })

    it("throws when a gated flag is 'true'", () => {
        expect(() => assertSafeFlags({ VITE_ENABLE_NFT: "true" })).toThrow(/VITE_ENABLE_NFT/)
    })

    it("throws listing EVERY enabled gated flag", () => {
        let msg = ""
        try {
            assertSafeFlags({ VITE_ENABLE_NFT: "true", VITE_ENABLE_SERVICES: "true" })
        } catch (e) {
            msg = (e as Error).message
        }
        expect(msg).toContain("VITE_ENABLE_NFT")
        expect(msg).toContain("VITE_ENABLE_SERVICES")
    })

    it("only the exact string 'true' enables (matches the app + the old CI gate)", () => {
        expect(() => assertSafeFlags({ VITE_ENABLE_NFT: "1" })).not.toThrow()
        expect(() => assertSafeFlags({ VITE_ENABLE_NFT: "TRUE" })).not.toThrow()
    })

    it("guards the fund-moving and incomplete-enforcement flags", () => {
        expect([...SAFETY_GATED_FLAGS]).toEqual([
            "VITE_ENABLE_NFT",
            "VITE_ENABLE_SERVICES",
            "VITE_ENABLE_TREASURY_SPEND",
            "VITE_ENABLE_AGENT_CREDITS",
            "VITE_ENABLE_REVIEWS",
        ])
    })
})

describe("VITE_ENABLE_REVIEWS gate", () => {
    it("is in SAFETY_GATED_FLAGS and trips assertSafeFlags when true", () => {
        expect(SAFETY_GATED_FLAGS).toContain("VITE_ENABLE_REVIEWS")
        expect(() => assertSafeFlags({ VITE_ENABLE_REVIEWS: "true" })).toThrow(/SAFETY GATE FAILED/)
        expect(() => assertSafeFlags({ VITE_ENABLE_REVIEWS: "false" })).not.toThrow()
    })
})

describe("shouldEnforceFlagGate", () => {
    it("enforces on a CI / local production build (no Netlify CONTEXT)", () => {
        expect(shouldEnforceFlagGate("build", undefined)).toBe(true)
    })
    it("enforces on the Netlify PRODUCTION build (CONTEXT=production)", () => {
        expect(shouldEnforceFlagGate("build", "production")).toBe(true)
    })
    it("does NOT enforce on Netlify deploy-previews (gated features are legitimately tested there)", () => {
        expect(shouldEnforceFlagGate("build", "deploy-preview")).toBe(false)
    })
    it("does NOT enforce on Netlify branch-deploys", () => {
        expect(shouldEnforceFlagGate("build", "branch-deploy")).toBe(false)
    })
    it("does NOT enforce in dev / serve", () => {
        expect(shouldEnforceFlagGate("serve", undefined)).toBe(false)
    })
})
