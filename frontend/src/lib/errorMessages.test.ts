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
        expect(msg).toContain("...")
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

    // ── Path leakage hardening (v2.22.1) ────────────────
    it("does not leak realm paths in panic errors", () => {
        const msg = friendlyError("panic: gno.land/r/samcrew/memba_dao: some internal error")
        expect(msg).not.toContain("gno.land/r/samcrew")
        expect(msg).toContain("unexpected error")
    })

    it("does not leak realm paths in plain errors", () => {
        const msg = friendlyError("error at gno.land/r/gov/dao/v3: bad state")
        expect(msg).not.toContain("gno.land/r/gov")
        expect(msg).toContain("unexpected error")
    })

    it("does not leak hex addresses", () => {
        const msg = friendlyError("0xdeadbeef: invalid pointer")
        expect(msg).not.toContain("0xdeadbeef")
        expect(msg).toContain("unexpected error")
    })

    it("extracts error class from Error: prefix without realm paths", () => {
        const msg = friendlyError("Error: InvalidArgument in request handler")
        expect(msg).toContain("InvalidArgument")
    })

    it("strips realm paths even from Error: messages", () => {
        const msg = friendlyError("Error: InvalidArgument — gno.land/r/samcrew/dao called with bad args")
        expect(msg).not.toContain("gno.land")
        expect(msg).toContain("unexpected error")
    })

    it("handles short Error: message", () => {
        const msg = friendlyError("Error: something failed")
        expect(msg).toBe("Error: something failed")
    })

    it("handles panic without realm path", () => {
        const msg = friendlyError("panic: slice bounds out of range")
        expect(msg).toContain("unexpected error")
        expect(msg).not.toContain("slice bounds")
    })

    // ── Profile / Identity errors (v2.25.1) ─────────────
    it("translates bio too long", () => {
        const msg = friendlyError("bio is too long")
        expect(msg).toContain("256 characters")
    })

    it("translates invalid avatar", () => {
        const msg = friendlyError("invalid avatar URL provided")
        expect(msg).toContain("invalid")
    })

    it("translates username taken", () => {
        const msg = friendlyError("username is already taken")
        expect(msg).toContain("already taken")
    })

    // ── GitHub OAuth errors (v2.25.1) ────────────────────
    it("translates OAuth state mismatch", () => {
        const msg = friendlyError("oauth state mismatch: expected abc got xyz")
        expect(msg).toContain("expired")
    })

    it("translates OAuth exchange failure", () => {
        const msg = friendlyError("oauth exchange failed: invalid code")
        expect(msg).toContain("GitHub login")
    })

    // ── Channel errors (v2.25.1) ─────────────────────────
    it("translates channel archived", () => {
        const msg = friendlyError("channel is archived")
        expect(msg).toContain("archived")
    })

    it("translates edit window expired", () => {
        const msg = friendlyError("edit window expired (100 blocks)")
        expect(msg).toContain("edit window")
    })

    it("translates max channels reached", () => {
        const msg = friendlyError("maximum 50 channels reached")
        expect(msg).toContain("50")
    })

    // ── Escrow errors (v2.25.1) ──────────────────────────
    it("translates milestone not funded", () => {
        const msg = friendlyError("milestone not funded")
        expect(msg).toContain("funded")
    })

    // ── Token errors (v2.25.1) ───────────────────────────
    it("translates token already exists", () => {
        const msg = friendlyError("token MEMBA already exists")
        expect(msg).toContain("already exists")
    })

    // ── Candidature errors (v2.25.1) ─────────────────────
    it("translates pending candidature", () => {
        const msg = friendlyError("You already have a pending candidature")
        expect(msg).toContain("pending candidature")
    })

    it("translates self-approval attempt", () => {
        const msg = friendlyError("Cannot approve your own candidature")
        expect(msg).toContain("can't approve your own")
    })

    // ── Backend HTTP errors (v2.25.1) ────────────────────
    it("translates 429 rate limit response", () => {
        const msg = friendlyError("429 Too Many Requests")
        expect(msg).toContain("too many requests")
    })

    it("translates 503 service unavailable", () => {
        const msg = friendlyError("503 Service Unavailable")
        expect(msg).toContain("temporarily unavailable")
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
