/**
 * Faucet Data Layer Tests
 *
 * Covers: eligibility checks, cooldown, claim recording,
 * history storage, formatting, and MsgSend builder.
 *
 * I9 fix: Updated tests for per-address storage pattern.
 * M12 fix: Removed unused vi import.
 */

import { describe, it, expect, beforeEach } from "vitest"
import {
    canClaimFaucet,
    recordFaucetClaim,
    getLastClaim,
    clearFaucetHistory,
    formatCooldown,
    buildFaucetMsgSend,
    FAUCET_AMOUNT_UGNOT,
    FAUCET_COOLDOWN_MS,
} from "./faucet"

const TEST_ADDR = "g1faucettest1234567890abcdefghij"
const TEST_ADDR_2 = "g1faucetother234567890abcdefghij"

beforeEach(() => {
    localStorage.clear()
})

// ── Eligibility ───────────────────────────────────────────────

describe("canClaimFaucet", () => {
    it("returns ineligible when no address", () => {
        const result = canClaimFaucet(null)
        expect(result.eligible).toBe(false)
        expect(result.reason).toContain("Connect")
    })

    it("returns eligible for fresh address", () => {
        const result = canClaimFaucet(TEST_ADDR)
        expect(result.eligible).toBe(true)
    })

    it("returns ineligible during cooldown", () => {
        recordFaucetClaim(TEST_ADDR)
        const result = canClaimFaucet(TEST_ADDR)
        expect(result.eligible).toBe(false)
        expect(result.reason).toContain("Cooldown")
        expect(result.cooldownRemaining).toBeGreaterThan(0)
        expect(result.nextClaimAt).toBeTruthy()
    })

    it("returns eligible after cooldown expires", () => {
        // Manually set a claim that's older than cooldown
        const oldClaim = {
            address: TEST_ADDR.toLowerCase(),
            claimedAt: Date.now() - FAUCET_COOLDOWN_MS - 1000,
            amount: FAUCET_AMOUNT_UGNOT,
        }
        localStorage.setItem(`memba_faucet_${TEST_ADDR.toLowerCase()}`, JSON.stringify(oldClaim))
        const result = canClaimFaucet(TEST_ADDR)
        expect(result.eligible).toBe(true)
    })

    it("is case-insensitive for addresses", () => {
        recordFaucetClaim(TEST_ADDR.toUpperCase())
        const result = canClaimFaucet(TEST_ADDR.toLowerCase())
        expect(result.eligible).toBe(false)
    })
})

// ── Claim Recording ───────────────────────────────────────────

describe("recordFaucetClaim", () => {
    it("stores a claim", () => {
        const claim = recordFaucetClaim(TEST_ADDR)
        expect(claim.address).toBe(TEST_ADDR.toLowerCase())
        expect(claim.amount).toBe(FAUCET_AMOUNT_UGNOT)
        expect(claim.claimedAt).toBeGreaterThan(0)
    })

    it("stores claims per-address (I9 fix)", () => {
        recordFaucetClaim(TEST_ADDR)
        recordFaucetClaim(TEST_ADDR_2)
        // Each address gets its own key
        expect(getLastClaim(TEST_ADDR)).not.toBeNull()
        expect(getLastClaim(TEST_ADDR_2)).not.toBeNull()
    })
})

// ── History ───────────────────────────────────────────────────

describe("getLastClaim", () => {
    it("returns null for no claims", () => {
        expect(getLastClaim(TEST_ADDR)).toBeNull()
    })

    it("returns the claim for address", () => {
        recordFaucetClaim(TEST_ADDR)
        const claim = getLastClaim(TEST_ADDR)
        expect(claim).not.toBeNull()
        expect(claim!.address).toBe(TEST_ADDR.toLowerCase())
    })

    it("returns null on corrupt data", () => {
        localStorage.setItem(`memba_faucet_${TEST_ADDR.toLowerCase()}`, "not-json")
        expect(getLastClaim(TEST_ADDR)).toBeNull()
    })
})

describe("clearFaucetHistory", () => {
    it("removes all claims", () => {
        recordFaucetClaim(TEST_ADDR)
        recordFaucetClaim(TEST_ADDR_2)
        clearFaucetHistory()
        expect(getLastClaim(TEST_ADDR)).toBeNull()
        expect(getLastClaim(TEST_ADDR_2)).toBeNull()
    })
})

// ── Formatting ────────────────────────────────────────────────

describe("formatCooldown", () => {
    it("formats days and hours", () => {
        const twoDaysFiveHours = 2 * 86_400_000 + 5 * 3_600_000
        expect(formatCooldown(twoDaysFiveHours)).toBe("in 2d 5h")
    })

    it("formats hours only", () => {
        expect(formatCooldown(3 * 3_600_000)).toBe("in 3h")
    })

    it("formats minutes", () => {
        expect(formatCooldown(30 * 60_000)).toBe("in 30m")
    })

    it("returns 'now' for zero or negative", () => {
        expect(formatCooldown(0)).toBe("now")
        expect(formatCooldown(-1)).toBe("now")
    })
})

// ── MsgSend Builder ───────────────────────────────────────────

describe("buildFaucetMsgSend", () => {
    it("builds correct MsgSend payload", () => {
        const msg = buildFaucetMsgSend("g1recipient", "g1treasury") as Record<string, unknown>
        expect(msg["@type"]).toBe("/bank.MsgSend")
        expect(msg.from_address).toBe("g1treasury")
        expect(msg.to_address).toBe("g1recipient")
        expect(msg.amount).toBe(`${FAUCET_AMOUNT_UGNOT}ugnot`)
    })
})
