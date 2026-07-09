import { describe, it, expect } from "vitest"
import { assertSafeFlags, SAFETY_GATED_FLAGS, shouldEnforceFlagGate } from "./safeFlags"

describe("assertSafeFlags", () => {
    it("passes when no gated flag is enabled", () => {
        expect(() => assertSafeFlags({ VITE_ENABLE_SERVICES: "false", VITE_GNO_CHAIN_ID: "test-13" })).not.toThrow()
    })

    it("passes when gated flags are absent", () => {
        expect(() => assertSafeFlags({})).not.toThrow()
    })

    it("fails CI if a safety gated flag is exactly 'true'", () => {
        // VITE_ENABLE_TREASURY_SPEND is gated
        expect(() => assertSafeFlags({ VITE_ENABLE_TREASURY_SPEND: "true" })).toThrow(/VITE_ENABLE_TREASURY_SPEND/)
    })

    it("lists all violating flags in the error message", () => {
        try {
            assertSafeFlags({ VITE_ENABLE_AGENT_CREDITS: "true", VITE_ENABLE_TREASURY_SPEND: "true" })
            throw new Error("Should have thrown")
        } catch (err: unknown) {
            const msg = (err as Error).message
            expect(msg).toContain("VITE_ENABLE_AGENT_CREDITS")
            expect(msg).toContain("VITE_ENABLE_TREASURY_SPEND")
        }
    })

    it("guards the fund-moving and incomplete-enforcement flags", () => {
        expect([...SAFETY_GATED_FLAGS]).toEqual([
            "VITE_ENABLE_TREASURY_SPEND",
            "VITE_ENABLE_AGENT_CREDITS",
            "VITE_ENABLE_APPSTORE_SUBMIT",
        ])
    })
})

describe("VITE_ENABLE_APPSTORE_SUBMIT (B3 money path — gated until the v3 fee path is verified)", () => {
    it("fails the prod build when enabled", () => {
        // RegisterApp attaches real coins (exact-fee ugnot send). The v3 realm is merged but NOT
        // deployed/migrated, and its fee-path runbook hasn't run — shipping this enabled could
        // move funds against an unverified path. De-gate ONLY after the owner's checklist passes.
        expect(SAFETY_GATED_FLAGS).toContain("VITE_ENABLE_APPSTORE_SUBMIT")
        expect(() => assertSafeFlags({ VITE_ENABLE_APPSTORE_SUBMIT: "true" })).toThrow(
            /VITE_ENABLE_APPSTORE_SUBMIT/,
        )
    })
})

describe("VITE_ENABLE_NFT (enabled — marketplace live: v3.1 deployed + registered)", () => {
    it("is no longer gated, so true does not fail the build", () => {
        expect(SAFETY_GATED_FLAGS).not.toContain("VITE_ENABLE_NFT")
        expect(() => assertSafeFlags({ VITE_ENABLE_NFT: "true" })).not.toThrow()
    })
})

describe("VITE_ENABLE_APPSTORE (de-gated 2026-07-07 — memba_appstore_v2 live on test13)", () => {
    it("is no longer gated, so true does not fail the build", () => {
        expect(SAFETY_GATED_FLAGS).not.toContain("VITE_ENABLE_APPSTORE")
        expect(() => assertSafeFlags({ VITE_ENABLE_APPSTORE: "true" })).not.toThrow()
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
