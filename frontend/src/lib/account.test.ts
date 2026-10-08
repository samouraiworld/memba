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
import { chainPublicKey, fetchAccountInfo } from "./account"
import { AbciQueryError } from "./rpcFallback"
import { abciQueryText, ChainAnswerError } from "./dao/packageStatus"

vi.mock("./dao/packageStatus", async (original) => ({ ...(await original<typeof import("./dao/packageStatus")>()), abciQueryText: vi.fn() }))

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

describe("chainPublicKey", () => {
    const KEY = { "@type": "/tm.PubKeySecp256k1", value: "A0key" }

    it("returns the key the chain holds, read from a node of the asked chain", async () => {
        vi.mocked(abciQueryText).mockResolvedValueOnce(JSON.stringify({ BaseAccount: { address: ADDR, public_key: KEY, sequence: "3" } }))
        await expect(chainPublicKey(ADDR, "gnoland-1")).resolves.toEqual(KEY)
        expect(vi.mocked(abciQueryText).mock.calls[0][0]).toMatchObject({ chainId: "gnoland-1" })
        expect(vi.mocked(abciQueryText).mock.calls[0][1]).toBe(`auth/accounts/${ADDR}`)
    })

    it("returns null for an address that never signed: no key, no account, or the chain's refusal", async () => {
        vi.mocked(abciQueryText).mockResolvedValueOnce(JSON.stringify({ BaseAccount: { address: ADDR, public_key: null, sequence: "0" } }))
        await expect(chainPublicKey(ADDR)).resolves.toBeNull()
        vi.mocked(abciQueryText).mockResolvedValueOnce("null")
        await expect(chainPublicKey(ADDR)).resolves.toBeNull()
        vi.mocked(abciQueryText).mockRejectedValueOnce(new ChainAnswerError("Query failed"))
        await expect(chainPublicKey(ADDR)).resolves.toBeNull()
    })

    it("throws when no node answers", async () => {
        vi.mocked(abciQueryText).mockRejectedValueOnce(new Error("fetch failed"))
        await expect(chainPublicKey(ADDR)).rejects.toThrow("fetch failed")
    })

    it("asks the chain for any spelling of an address, upper case included, and answers null for what is not one", async () => {
        vi.mocked(abciQueryText).mockClear()
        vi.mocked(abciQueryText).mockResolvedValueOnce(JSON.stringify({ BaseAccount: { public_key: KEY } }))
        await expect(chainPublicKey(ADDR.toUpperCase())).resolves.toEqual(KEY)
        expect(vi.mocked(abciQueryText).mock.calls[0][1]).toBe(`auth/accounts/${ADDR.toUpperCase()}`)
        vi.mocked(abciQueryText).mockClear()
        for (const text of ['g1"x', "", `${ADDR}x`, "g1b"]) await expect(chainPublicKey(text)).resolves.toBeNull()
        expect(abciQueryText).not.toHaveBeenCalled()
    })
})
