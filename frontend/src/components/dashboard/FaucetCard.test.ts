/**
 * Tests for FaucetCard component logic.
 *
 * Tests the data layer interaction: eligibility checks, claim recording,
 * cooldown display, and session state.
 */

import { describe, test, expect, beforeEach } from "vitest"
import {
    canClaimFaucet,
    recordFaucetClaim,
    getLastClaim,
    clearFaucetHistory,
    formatCooldown,
    FAUCET_AMOUNT_UGNOT,
    FAUCET_COOLDOWN_MS,
    buildFaucetMsgSend,
} from "../../lib/faucet"

describe("FaucetCard — eligibility integration", () => {
    beforeEach(() => {
        localStorage.clear()
    })

    test("returns eligible for fresh address", () => {
        const result = canClaimFaucet("g1test123abc456")
        expect(result.eligible).toBe(true)
        expect(result.reason).toBeUndefined()
    })

    test("returns ineligible when wallet not connected", () => {
        const result = canClaimFaucet(null)
        expect(result.eligible).toBe(false)
        expect(result.reason).toContain("Connect your wallet")
    })

    test("records claim and blocks re-claim within cooldown", () => {
        const addr = "g1claimtest123"
        recordFaucetClaim(addr)

        const result = canClaimFaucet(addr)
        expect(result.eligible).toBe(false)
        expect(result.cooldownRemaining).toBeGreaterThan(0)
        expect(result.nextClaimAt).toBeDefined()
    })

    test("claim is recorded per-address", () => {
        const addr1 = "g1addr1test123"
        const addr2 = "g1addr2test456"

        recordFaucetClaim(addr1)

        expect(canClaimFaucet(addr1).eligible).toBe(false)
        expect(canClaimFaucet(addr2).eligible).toBe(true)
    })

    test("getLastClaim returns null for fresh address", () => {
        expect(getLastClaim("g1fresh")).toBeNull()
    })

    test("getLastClaim returns claim after recording", () => {
        const addr = "g1claimed"
        recordFaucetClaim(addr)
        const claim = getLastClaim(addr)
        expect(claim).not.toBeNull()
        expect(claim!.address).toBe(addr)
        expect(claim!.amount).toBe(FAUCET_AMOUNT_UGNOT)
    })

    test("clearFaucetHistory removes all claims", () => {
        recordFaucetClaim("g1a")
        recordFaucetClaim("g1b")
        clearFaucetHistory()
        expect(getLastClaim("g1a")).toBeNull()
        expect(getLastClaim("g1b")).toBeNull()
    })

    test("cooldown expires after FAUCET_COOLDOWN_MS", () => {
        const addr = "g1expired"
        recordFaucetClaim(addr)

        // Manually set claimedAt to 8 days ago
        const key = `memba_faucet_${addr}`
        const claim = JSON.parse(localStorage.getItem(key)!)
        claim.claimedAt = Date.now() - FAUCET_COOLDOWN_MS - 1000
        localStorage.setItem(key, JSON.stringify(claim))

        expect(canClaimFaucet(addr).eligible).toBe(true)
    })

    test("buildFaucetMsgSend produces correct message", () => {
        const msg = buildFaucetMsgSend("g1recipient", "g1treasury")
        expect(msg).toEqual({
            "@type": "/bank.MsgSend",
            from_address: "g1treasury",
            to_address: "g1recipient",
            amount: `${FAUCET_AMOUNT_UGNOT}ugnot`,
        })
    })
})

describe("formatCooldown", () => {
    test("returns 'now' for 0 or negative", () => {
        expect(formatCooldown(0)).toBe("now")
        expect(formatCooldown(-1000)).toBe("now")
    })

    test("formats minutes", () => {
        expect(formatCooldown(30 * 60 * 1000)).toBe("in 30m")
    })

    test("formats hours", () => {
        expect(formatCooldown(5 * 60 * 60 * 1000)).toBe("in 5h")
    })

    test("formats days and hours", () => {
        const twoAndHalf = 2 * 24 * 60 * 60 * 1000 + 12 * 60 * 60 * 1000
        expect(formatCooldown(twoAndHalf)).toBe("in 2d 12h")
    })
})
