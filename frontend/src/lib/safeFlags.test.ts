import { describe, it, expect } from "vitest"
import { assertSafeFlags, SAFETY_GATED_FLAGS, shouldEnforceFlagGate } from "./safeFlags"

describe("assertSafeFlags", () => {
    it("passes when no gated flag is enabled", () => {
        expect(() => assertSafeFlags({ VITE_ENABLE_SERVICES: "false", VITE_GNO_CHAIN_ID: "test-13" })).not.toThrow()
    })

    it("passes when gated flags are absent", () => {
        expect(() => assertSafeFlags({})).not.toThrow()
    })

    it("throws when a gated flag is 'true'", () => {
        expect(() => assertSafeFlags({ VITE_ENABLE_SERVICES: "true" })).toThrow(/VITE_ENABLE_SERVICES/)
    })

    it("throws listing EVERY enabled gated flag", () => {
        let msg = ""
        try {
            assertSafeFlags({ VITE_ENABLE_SERVICES: "true", VITE_ENABLE_TREASURY_SPEND: "true" })
        } catch (e) {
            msg = (e as Error).message
        }
        expect(msg).toContain("VITE_ENABLE_SERVICES")
        expect(msg).toContain("VITE_ENABLE_TREASURY_SPEND")
    })

    it("only the exact string 'true' enables (matches the app + the old CI gate)", () => {
        expect(() => assertSafeFlags({ VITE_ENABLE_SERVICES: "1" })).not.toThrow()
        expect(() => assertSafeFlags({ VITE_ENABLE_SERVICES: "TRUE" })).not.toThrow()
    })

    it("guards the fund-moving and incomplete-enforcement flags", () => {
        expect([...SAFETY_GATED_FLAGS]).toEqual([
            "VITE_ENABLE_SERVICES",
            "VITE_ENABLE_TREASURY_SPEND",
            "VITE_ENABLE_AGENT_CREDITS",
        ])
    })
})

describe("VITE_ENABLE_NFT (enabled — marketplace live: v3.1 deployed + registered)", () => {
    it("is no longer gated, so true does not fail the build", () => {
        expect(SAFETY_GATED_FLAGS).not.toContain("VITE_ENABLE_NFT")
        expect(() => assertSafeFlags({ VITE_ENABLE_NFT: "true" })).not.toThrow()
    })
})

describe("VITE_ENABLE_REVIEWS (enabled — realm deployed + reviewed)", () => {
    it("is no longer gated, so true does not fail the build", () => {
        expect(SAFETY_GATED_FLAGS).not.toContain("VITE_ENABLE_REVIEWS")
        expect(() => assertSafeFlags({ VITE_ENABLE_REVIEWS: "true" })).not.toThrow()
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
