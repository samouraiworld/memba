/**
 * tokenOtcApi.test.ts — getOtcEngineAddress (WAVE1 TR-P0-4).
 *
 * The OTC realm's Approve/Allowance take an `address` argument, not a
 * package path. The frontend was passing MEMBA_DAO.tokenOtcPath (a path
 * string, e.g. "gno.land/r/samcrew/memba_token_otc_v2") as the spender —
 * but the realm checks allowance against its own resolved address
 * (`cur.Address()` / `EngineAddress()`), so approval never matched and
 * both List and Fill reverted. This module resolves the real address.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const queryEval = vi.fn()
vi.mock("./dao/shared", () => ({
    queryEval: (...a: unknown[]) => queryEval(...a),
}))

import { getOtcEngineAddress, __resetOtcEngineAddressCache } from "./tokenOtcApi"

describe("getOtcEngineAddress", () => {
    beforeEach(() => {
        queryEval.mockReset()
        __resetOtcEngineAddressCache()
    })

    it("parses the address out of the qeval response", async () => {
        queryEval.mockResolvedValueOnce('("g1otcenginexxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" address)')

        const addr = await getOtcEngineAddress()

        expect(addr).toBe("g1otcenginexxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx")
    })

    it("queries EngineAddress() on the OTC realm path, not tokenfactory", async () => {
        queryEval.mockResolvedValueOnce('("g1abc" address)')

        await getOtcEngineAddress()

        expect(queryEval).toHaveBeenCalledTimes(1)
        const [, pkgPath, expr] = queryEval.mock.calls[0]
        expect(pkgPath).toContain("memba_token_otc_v2")
        expect(expr).toBe("EngineAddress()")
    })

    it("caches the resolved address — a second call does not re-query", async () => {
        queryEval.mockResolvedValueOnce('("g1abc" address)')

        const first = await getOtcEngineAddress()
        const second = await getOtcEngineAddress()

        expect(first).toBe("g1abc")
        expect(second).toBe("g1abc")
        expect(queryEval).toHaveBeenCalledTimes(1)
    })

    it("throws a clear error when the realm is unreachable, rather than silently returning a bad spender", async () => {
        queryEval.mockResolvedValueOnce(null)

        await expect(getOtcEngineAddress()).rejects.toThrow(/OTC engine address/i)
    })

    it("throws a clear error when the response is malformed", async () => {
        queryEval.mockResolvedValueOnce("garbage, not an address response")

        await expect(getOtcEngineAddress()).rejects.toThrow(/OTC engine address/i)
    })
})
