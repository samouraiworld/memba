/**
 * GRC20 Mint Fee Double-Charge Regression Tests — A4 (AAA-0)
 *
 * The tokenfactory realm already applies a 2.5% fee on-chain via `applyFee`.
 * The client-side builders were ALSO appending a Transfer to FEE_RECIPIENT,
 * resulting in users being charged 5% (double the disclosed 2.5%).
 *
 * These tests assert that the client-side fee transfer messages have been
 * removed, and the builders produce the exact correct message arrays.
 *
 * @see docs/planning/MEMBA_AAA_IMPLEMENTATION_PLAN.md §5/A4
 */
import { describe, it, expect } from "vitest"
import {
    buildMintMsgs,
    buildCreateTokenMsgs,
    buildCreateTokenWithAdminMsgs,
    FEE_RECIPIENT,
    feeDisclosure,
} from "../lib/grc20"

describe("GRC20 double-charge fix (A4)", () => {
    const caller = "g1testaddr1234567890abcdefghijklmnop"

    describe("buildMintMsgs", () => {
        it("should produce exactly 1 message (Mint only, no fee Transfer)", () => {
            const msgs = buildMintMsgs(caller, "SAM", caller, 1000n)

            expect(msgs).toHaveLength(1)
            expect(msgs[0].value.func).toBe("Mint")
        })

        it("should NOT contain a Transfer to FEE_RECIPIENT", () => {
            const msgs = buildMintMsgs(caller, "SAM", caller, 1000000n)

            const feeTransfers = msgs.filter(
                (m) => m.value.func === "Transfer" && (m.value.args as string[])[1] === FEE_RECIPIENT,
            )
            expect(feeTransfers).toHaveLength(0)
        })

        it("should handle zero amount", () => {
            const msgs = buildMintMsgs(caller, "SAM", caller, 0n)

            expect(msgs).toHaveLength(1)
            expect(msgs[0].value.func).toBe("Mint")
        })

        it("should allow minting to a third-party address (previously failed due to fee Transfer from caller balance)", () => {
            const thirdParty = "g1otheraddr234567890abcdefghijklmnop"
            const msgs = buildMintMsgs(caller, "SAM", thirdParty, 1000n)

            expect(msgs).toHaveLength(1)
            expect(msgs[0].value.func).toBe("Mint")
            expect((msgs[0].value.args as string[])[1]).toBe(thirdParty)
        })
    })

    describe("buildCreateTokenMsgs", () => {
        it("should produce exactly 1 message (New only) even with initialMint > 0", () => {
            const msgs = buildCreateTokenMsgs(caller, "Test Token", "TEST", 6, 1000000n, 0n)

            expect(msgs).toHaveLength(1)
            expect(msgs[0].value.func).toBe("New")
        })

        it("should NOT contain a Transfer to FEE_RECIPIENT", () => {
            const msgs = buildCreateTokenMsgs(caller, "Test", "TEST", 6, 1000000n, 0n)

            const feeTransfers = msgs.filter(
                (m) => m.value.func === "Transfer" && (m.value.args as string[])[1] === FEE_RECIPIENT,
            )
            expect(feeTransfers).toHaveLength(0)
        })

        it("should produce 1 message for zero initialMint", () => {
            const msgs = buildCreateTokenMsgs(caller, "Test", "TEST", 6, 0n, 0n)

            expect(msgs).toHaveLength(1)
            expect(msgs[0].value.func).toBe("New")
        })
    })

    describe("buildCreateTokenWithAdminMsgs", () => {
        it("should produce exactly 1 message (NewWithAdmin only) even with initialMint > 0", () => {
            const admin = "g1adminaddr234567890abcdefghijklmnop"
            const msgs = buildCreateTokenWithAdminMsgs(caller, "Test", "TEST", 6, 1000000n, 0n, admin)

            expect(msgs).toHaveLength(1)
            expect(msgs[0].value.func).toBe("NewWithAdmin")
        })

        it("should NOT contain a Transfer to FEE_RECIPIENT", () => {
            const admin = "g1adminaddr234567890abcdefghijklmnop"
            const msgs = buildCreateTokenWithAdminMsgs(caller, "Test", "TEST", 6, 1000000n, 0n, admin)

            const feeTransfers = msgs.filter(
                (m) => m.value.func === "Transfer" && (m.value.args as string[])[1] === FEE_RECIPIENT,
            )
            expect(feeTransfers).toHaveLength(0)
        })
    })

    describe("feeDisclosure (kept intact)", () => {
        it("should still describe the 2.5% fee accurately", () => {
            const text = feeDisclosure(1000n, "SAM")

            expect(text).toContain("2.5%")
            expect(text).toContain("25 SAM") // 2.5% of 1000
            expect(text).toContain("Samouraï Coop")
        })
    })
})
