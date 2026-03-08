/**
 * Unit tests for errorMessages.ts — user-friendly error translation.
 */
import { describe, it, expect } from "vitest"
import { friendlyError, extractMessage, isUserCancellation } from "./errorMessages"

describe("friendlyError", () => {
    // ── Chain / ABCI errors ──────────────────────────────
    it("translates import errors", () => {
        const msg = friendlyError('could not import std (unknown import path "std")')
        expect(msg).toContain("unsupported import")
    })

    it("translates out of gas", () => {
        const msg = friendlyError("out of gas in location: ReadFlat")
        expect(msg).toContain("ran out of gas")
    })

    it("translates insufficient funds", () => {
        const msg = friendlyError("insufficient funds for transfer")
        expect(msg).toContain("Not enough GNOT")
    })

    it("translates not a member", () => {
        const msg = friendlyError("panic: not a member")
        expect(msg).toContain("not a member")
    })

    it("translates already voted", () => {
        const msg = friendlyError("panic: already voted")
        expect(msg).toContain("already voted")
    })

    it("translates archived DAO", () => {
        const msg = friendlyError("panic: DAO is archived")
        expect(msg).toContain("archived")
    })

    it("translates rate limited", () => {
        const msg = friendlyError("rate limited: wait 5 blocks")
        expect(msg).toContain("posting too quickly")
    })

    it("translates package already exists", () => {
        const msg = friendlyError("package already exists")
        expect(msg).toContain("already exists")
    })

    // ── Adena / Wallet errors ────────────────────────────
    it("translates user rejected", () => {
        const msg = friendlyError("user rejected the request")
        expect(msg).toContain("cancelled")
    })

    it("translates wallet not connected", () => {
        const msg = friendlyError("wallet not connected")
        expect(msg).toContain("not connected")
    })

    it("translates Adena not found", () => {
        const msg = friendlyError("adena not found in window")
        expect(msg).toContain("not detected")
    })

    // ── Network errors ───────────────────────────────────
    it("translates failed to fetch", () => {
        const msg = friendlyError("Failed to fetch")
        expect(msg).toContain("internet connection")
    })

    it("translates timeout", () => {
        const msg = friendlyError("request timeout after 30s")
        expect(msg).toContain("timed out")
    })

    // ── Fallbacks ────────────────────────────────────────
    it("handles unknown errors gracefully", () => {
        const msg = friendlyError("some random error string")
        expect(msg).toBe("some random error string")
    })

    it("truncates very long messages", () => {
        const msg = friendlyError("x".repeat(300))
        expect(msg.length).toBeLessThan(210)
        expect(msg).toContain("…")
    })

    it("handles null/undefined errors", () => {
        expect(friendlyError(null)).toBe("Something went wrong. Please try again.")
        expect(friendlyError(undefined)).toBe("Something went wrong. Please try again.")
    })

    it("handles Error objects", () => {
        const msg = friendlyError(new Error("insufficient funds"))
        expect(msg).toContain("Not enough GNOT")
    })

    it("wraps panic-style errors", () => {
        const msg = friendlyError("panic: unexpected internal state 0x1234")
        expect(msg).toContain("unexpected error")
    })
})

describe("extractMessage", () => {
    it("handles strings", () => {
        expect(extractMessage("hello")).toBe("hello")
    })

    it("handles Error objects", () => {
        expect(extractMessage(new Error("test"))).toBe("test")
    })

    it("handles objects with message field", () => {
        expect(extractMessage({ message: "obj error" })).toBe("obj error")
    })

    it("handles objects with error field", () => {
        expect(extractMessage({ error: "obj error" })).toBe("obj error")
    })

    it("handles null", () => {
        expect(extractMessage(null)).toBe("")
    })
})

describe("isUserCancellation", () => {
    it("detects user rejected", () => {
        expect(isUserCancellation("User rejected the request")).toBe(true)
    })

    it("detects user denied", () => {
        expect(isUserCancellation(new Error("user denied"))).toBe(true)
    })

    it("returns false for real errors", () => {
        expect(isUserCancellation("out of gas")).toBe(false)
    })
})
