import { describe, it, expect } from "vitest"
import { assertSafeFlags, SAFETY_GATED_FLAGS } from "./safeFlags"

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

    it("guards the four fund-moving flags", () => {
        expect([...SAFETY_GATED_FLAGS]).toEqual([
            "VITE_ENABLE_NFT",
            "VITE_ENABLE_SERVICES",
            "VITE_ENABLE_TREASURY_SPEND",
            "VITE_ENABLE_AGENT_CREDITS",
        ])
    })
})
