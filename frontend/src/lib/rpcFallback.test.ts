import { describe, it, expect, vi, afterEach } from "vitest"
import { resilientAbciQuery } from "./rpcFallback"

afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
})

// FE-2: resilientAbciQuery conflated "realm rendered nothing" (empty) with
// "every RPC endpoint is down" (failure) — both returned null — so a DAO read
// failure surfaced as a blank card instead of an error+retry. strict=true lets
// the all-endpoints-down case throw so callers (DAOHome, featured-DAO door) can
// distinguish failure from empty.
describe("resilientAbciQuery strict mode", () => {
    it("throws when every RPC endpoint fails and strict=true", async () => {
        vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")))
        await expect(resilientAbciQuery("vm/qrender", "gno.land/r/x:", true)).rejects.toThrow()
    })

    it("still returns null (unchanged) when every endpoint fails and strict=false", async () => {
        vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")))
        await expect(resilientAbciQuery("vm/qrender", "gno.land/r/x:", false)).resolves.toBeNull()
    })

    it("defaults to non-strict (null on failure) when no flag is passed", async () => {
        vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")))
        await expect(resilientAbciQuery("vm/qrender", "gno.land/r/x:")).resolves.toBeNull()
    })

    it("returns null for a genuinely-empty render even when strict=true (empty is not a failure)", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ result: { response: { ResponseBase: {} } } }),
        }))
        await expect(resilientAbciQuery("vm/qrender", "gno.land/r/x:", true)).resolves.toBeNull()
    })
})
