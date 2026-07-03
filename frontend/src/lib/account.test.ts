/**
 * fetchAccountInfo — W2.2 (R2-CHN-G) fail-loud contract.
 *
 * The old implementation returned {0,0} on ANY failure, feeding sequence:0
 * into multisig sign-docs whenever the RPC was down (tx dies on-chain with a
 * sequence mismatch) and making "RPC unreachable" indistinguishable from
 * "account not on-chain". These tests pin the new contract: zeros ONLY when
 * the chain answered and the account has no record; everything else throws.
 */
import { describe, it, expect, vi, afterEach } from "vitest"
import { fetchAccountInfo } from "./account"
import { AbciQueryError } from "./rpcFallback"

const ADDR = "g1747t5m2f08plqjlrjk2q0qld7465hxz8gkx59c"

function abciResponse(base: Record<string, unknown>) {
    return {
        ok: true,
        json: async () => ({ result: { response: { ResponseBase: base } } }),
    }
}

afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
})

describe("fetchAccountInfo — fail-loud (W2.2)", () => {
    it("parses account number + sequence on the happy path", async () => {
        const account = { BaseAccount: { account_number: "42", sequence: "7" } }
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(abciResponse({ Value: btoa(JSON.stringify(account)) })))
        await expect(fetchAccountInfo(ADDR)).resolves.toEqual({ accountNumber: 42, sequence: 7 })
    })

    it("returns {0,0} for a never-transacted account (clean-empty encoding)", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(abciResponse({ Value: null })))
        await expect(fetchAccountInfo(ADDR)).resolves.toEqual({ accountNumber: 0, sequence: 0 })
    })

    it("returns {0,0} for the LIVE chain's no-record encoding: ABCI error object, no Value", async () => {
        // The real test13 answer for an unfunded address (see backend
        // render_proxy.go + its live tests): Error={"@type":".../std.UnknownAddressError"},
        // Value absent. This is account state, NOT a failure — review finding #1
        // (throwing here bricked first-tx multisig proposes and quest verification
        // for exactly the never-transacted audience).
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(abciResponse({
            Error: { "@type": "/std.UnknownAddressError" },
            Log: "unknown request",
            Value: null,
        })))
        await expect(fetchAccountInfo(ADDR)).resolves.toEqual({ accountNumber: 0, sequence: 0 })
    })

    it("THROWS on transport failure — never a silent {0,0} into a sign-doc", async () => {
        vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")))
        await expect(fetchAccountInfo(ADDR)).rejects.toThrow(/Could not read on-chain account state/)
    })

    it("THROWS an AbciQueryError only for the anomaly: error AND a Value together", async () => {
        const account = { BaseAccount: { account_number: "1", sequence: "1" } }
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(abciResponse({
            Error: { "@type": "/std.InternalError" },
            Log: "storage fault",
            Value: btoa(JSON.stringify(account)),
        })))
        await expect(fetchAccountInfo(ADDR)).rejects.toThrow(AbciQueryError)
    })

    it("THROWS on an unparseable account payload (was silent {0,0})", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(abciResponse({ Value: btoa("not-json{{") })))
        await expect(fetchAccountInfo(ADDR)).rejects.toThrow()
    })

    it("THROWS on an invalid address instead of querying", async () => {
        const fetchSpy = vi.fn()
        vi.stubGlobal("fetch", fetchSpy)
        await expect(fetchAccountInfo("not-an-address")).rejects.toThrow(/not a valid gno address/)
        expect(fetchSpy).not.toHaveBeenCalled()
    })
})
