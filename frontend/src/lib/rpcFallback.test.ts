import { describe, it, expect, vi, afterEach } from "vitest"
import { resilientAbciQuery, resilientAbciQueryDetailed, getRpcUrlsInOrder, AbciQueryError, abciErrorPresent } from "./rpcFallback"

afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
})

// Helpers for the dedup/retry suites.
const okData = (text: string) => ({ ok: true, json: async () => ({ result: { response: { ResponseBase: { Data: btoa(text) } } } }) })
const emptyResp = () => ({ ok: true, json: async () => ({ result: { response: { ResponseBase: {} } } }) })

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

// W2.2 (R2-CHN-D): ResponseBase.Error was ignored at every ABCI site — a
// non-deployed realm, a bad path and a VM panic all looked like an empty
// render. The detailed variant discriminates, and strict callers now get the
// ABCI error instead of a silent null.
describe("resilientAbciQueryDetailed — discriminated outcomes", () => {
    it("returns kind=ok with decoded text on the happy path", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ result: { response: { ResponseBase: { Data: btoa("# hello") } } } }),
        }))
        await expect(resilientAbciQueryDetailed("vm/qrender", "gno.land/r/x:")).resolves.toEqual({ kind: "ok", text: "# hello" })
    })

    it("returns kind=empty when the realm rendered nothing", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ result: { response: { ResponseBase: {} } } }),
        }))
        await expect(resilientAbciQueryDetailed("vm/qrender", "gno.land/r/x:")).resolves.toEqual({ kind: "empty" })
    })

    it("returns kind=abci-error (path + log preserved) when ResponseBase.Error is set", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                result: { response: { ResponseBase: { Error: { "@type": "/vm.InvalidPkgPathError" }, Log: "invalid package path", Data: null } } },
            }),
        }))
        const res = await resilientAbciQueryDetailed("vm/qrender", "gno.land/r/missing:")
        expect(res.kind).toBe("abci-error")
        if (res.kind === "abci-error") {
            expect(res.error).toBeInstanceOf(AbciQueryError)
            expect(res.error.path).toBe("vm/qrender")
            expect(res.error.log).toBe("invalid package path")
            expect(res.error.message).toMatch(/invalid package path/)
        }
    })

    it("throws on transport failure (all endpoints down) — never a silent kind", async () => {
        vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")))
        await expect(resilientAbciQueryDetailed("vm/qrender", "gno.land/r/x:")).rejects.toThrow()
    })
})

describe("resilientAbciQuery — ABCI-level errors reach strict callers (W2.2)", () => {
    it("strict=true: throws AbciQueryError when ResponseBase.Error is set (was silent null)", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                result: { response: { ResponseBase: { Error: { "@type": "/vm.InvalidPkgPathError" }, Log: "invalid package path" } } },
            }),
        }))
        await expect(resilientAbciQuery("vm/qrender", "gno.land/r/missing:", true)).rejects.toThrow(AbciQueryError)
    })

    it("strict=false: keeps the old null for ABCI-level errors (back-compat)", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                result: { response: { ResponseBase: { Error: { "@type": "/vm.InvalidPkgPathError" }, Log: "x" } } },
            }),
        }))
        await expect(resilientAbciQuery("vm/qrender", "gno.land/r/missing:", false)).resolves.toBeNull()
    })
})

// Review follow-up: gno encodes "no error" as null but "" has been observed;
// a present error may be a string or an object. Mirror the backend's
// abciErrorPresent semantics so "" is never misclassified as an ABCI error.
describe("abciErrorPresent", () => {
    it("treats null / undefined / empty-ish strings as absent", () => {
        expect(abciErrorPresent(null)).toBe(false)
        expect(abciErrorPresent(undefined)).toBe(false)
        expect(abciErrorPresent("")).toBe(false)
        expect(abciErrorPresent("   ")).toBe(false)
    })
    it("treats non-empty strings and objects as present", () => {
        expect(abciErrorPresent("not found")).toBe(true)
        expect(abciErrorPresent({ "@type": "/std.InvalidAddressError" })).toBe(true)
    })
})

// W3.3: the same qrender/qeval fires from several call-sites during a render
// pass. Concurrent identical reads must collapse to one round-trip, but only
// while in flight (never a stale cache).
describe("resilientAbciQueryDetailed — in-flight dedup (W3.3)", () => {
    it("coalesces concurrent identical reads into one fetch", async () => {
        let resolveFetch!: (v: unknown) => void
        const fetchMock = vi.fn(() => new Promise((r) => { resolveFetch = r }))
        vi.stubGlobal("fetch", fetchMock)

        const p1 = resilientAbciQueryDetailed("vm/qrender", "gno.land/r/x:")
        const p2 = resilientAbciQueryDetailed("vm/qrender", "gno.land/r/x:")
        // Both share one in-flight request.
        expect(fetchMock).toHaveBeenCalledTimes(1)

        resolveFetch(okData("# shared"))
        const [r1, r2] = await Promise.all([p1, p2])
        expect(r1).toEqual({ kind: "ok", text: "# shared" })
        expect(r2).toEqual(r1)
    })

    it("does NOT coalesce reads with different path/data", async () => {
        const fetchMock = vi.fn().mockResolvedValue(emptyResp())
        vi.stubGlobal("fetch", fetchMock)
        await Promise.all([
            resilientAbciQueryDetailed("vm/qrender", "gno.land/r/a:"),
            resilientAbciQueryDetailed("vm/qrender", "gno.land/r/b:"),
        ])
        expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it("re-reads after the in-flight request settles (coalescing, not caching)", async () => {
        const fetchMock = vi.fn().mockResolvedValue(okData("# x"))
        vi.stubGlobal("fetch", fetchMock)
        await resilientAbciQueryDetailed("vm/qrender", "gno.land/r/x:")
        await resilientAbciQueryDetailed("vm/qrender", "gno.land/r/x:")
        expect(fetchMock).toHaveBeenCalledTimes(2)
    })
})

// W3.4: a transient blip on a healthy primary shouldn't demote it to a fallback.
describe("resilientFetch — same-URL retry before failover (W3.4)", () => {
    it("retries the SAME url once on a network blip, then succeeds", async () => {
        const fetchMock = vi.fn()
            .mockRejectedValueOnce(new Error("ECONNREFUSED"))
            .mockResolvedValueOnce(okData("# ok"))
        vi.stubGlobal("fetch", fetchMock)

        const res = await resilientAbciQueryDetailed("vm/qrender", "gno.land/r/x:")
        expect(res).toEqual({ kind: "ok", text: "# ok" })
        expect(fetchMock).toHaveBeenCalledTimes(2)
        // Same url both times — no premature failover.
        expect(fetchMock.mock.calls[1][0]).toBe(fetchMock.mock.calls[0][0])
    })

    it("retries the same url on a 5xx, then succeeds", async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce({ ok: false, status: 502 })
            .mockResolvedValueOnce(okData("# ok"))
        vi.stubGlobal("fetch", fetchMock)

        const res = await resilientAbciQueryDetailed("vm/qrender", "gno.land/r/x:")
        expect(res).toEqual({ kind: "ok", text: "# ok" })
        expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it("does NOT retry a 4xx — one attempt per url", async () => {
        const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 400 })
        vi.stubGlobal("fetch", fetchMock)
        await expect(resilientAbciQueryDetailed("vm/qrender", "gno.land/r/x:")).rejects.toThrow()
        expect(fetchMock).toHaveBeenCalledTimes(getRpcUrlsInOrder().length)
    })

    it("retries each url once on persistent network errors before giving up", async () => {
        const fetchMock = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"))
        vi.stubGlobal("fetch", fetchMock)
        await expect(resilientAbciQueryDetailed("vm/qrender", "gno.land/r/x:")).rejects.toThrow()
        // Each url attempted (1 + SAME_URL_RETRIES) times.
        expect(fetchMock).toHaveBeenCalledTimes(getRpcUrlsInOrder().length * 2)
    })
})
