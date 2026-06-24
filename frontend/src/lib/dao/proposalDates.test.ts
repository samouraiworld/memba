/**
 * Tests for the tx_search circuit-breaker in resolveProposalTimestamp.
 *
 * test13 RPC nodes return 404 for `tx_search`; resilientRpcCall then walks
 * 3 nodes per proposal → dozens of console 404s (the DB4 symptom). After the
 * first failure we disable tx_search for the session so later proposals skip it.
 */
import { describe, test, expect, vi, beforeEach } from "vitest"

const { resilientRpcCall } = vi.hoisted(() => ({ resilientRpcCall: vi.fn() }))

vi.mock("../rpcFallback", () => ({
    resilientRpcCall,
}))

import { resolveProposalTimestamp } from "./proposalDates"

beforeEach(() => {
    resilientRpcCall.mockReset()
    try { sessionStorage.clear() } catch { /* jsdom */ }
})

describe("resolveProposalTimestamp tx_search breaker", () => {
    test("stops attempting tx_search after the first failure (kills GovDAO 404 spam)", async () => {
        // Simulate test13: tx_search rejects on every node.
        resilientRpcCall.mockRejectedValue(new Error("404 page not found"))

        // No createdAt/createdAtBlock → both fall through to Strategy 3 (tx_search).
        const first = await resolveProposalTimestamp("gno.land/r/gov/dao", 101)
        const second = await resolveProposalTimestamp("gno.land/r/gov/dao", 102)

        expect(first).toBeNull()
        expect(second).toBeNull()

        // tx_search attempted exactly once across both proposals — the breaker
        // tripped on the first failure and the second proposal skipped it.
        const txSearchCalls = resilientRpcCall.mock.calls.filter(c => c[0] === "tx_search")
        expect(txSearchCalls).toHaveLength(1)
    })
})
