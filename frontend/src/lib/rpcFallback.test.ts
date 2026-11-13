import { describe, it, expect, vi, afterEach } from "vitest"
import { resilientAbciQuery, resilientAbciQueryDetailed, getRpcUrlsInOrder, AbciQueryError, RpcRefusedError, abciErrorPresent } from "./rpcFallback"

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

// B-9 follow-up: a node that answers HTTP 200 with a TOP-LEVEL JSON-RPC error
// (not synced, internal error, a proxy's JSON error body) previously fell
// through to "empty" — strict callers got null, which reads exactly like
// "realm not deployed" and E-F9-drops the user's saved DAO entries during a
// node failure. Node-level errors are TRANSPORT-class: they must throw a
// PLAIN Error — never an AbciQueryError, which callers treat as the chain's
// own "not deployed here" answer. Mirrors resilientRpcCall and the backend's
// render_proxy (rpc error → hard failure, not empty).
describe("resilientAbciQuery — node-level JSON-RPC errors are transport failures", () => {
    const rpcErrorResp = () => ({
        ok: true,
        json: async () => ({ jsonrpc: "2.0", id: "memba-dao", error: { code: -32603, message: "node is catching up" } }),
    })
    const noBaseResp = () => ({
        ok: true,
        json: async () => ({ result: {} }),
    })

    it("strict=true: throws a PLAIN error (never AbciQueryError) on a top-level JSON-RPC error", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(rpcErrorResp()))
        let thrown: unknown
        try {
            await resilientAbciQuery("vm/qrender", "gno.land/r/nodeerr-a:", true)
        } catch (err) { thrown = err }
        expect(thrown).toBeInstanceOf(Error)
        expect(thrown).not.toBeInstanceOf(AbciQueryError)
        expect((thrown as Error).message).toMatch(/catching up/)
    })

    it("strict=false: a JSON-RPC error on EVERY node rejects — never a null that reads as empty", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(rpcErrorResp()))
        await expect(resilientAbciQuery("vm/qrender", "gno.land/r/nodeerr-b:", false)).rejects.toThrow(RpcRefusedError)
    })

    it("strict=true: throws a PLAIN error on a malformed response with no ResponseBase", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(noBaseResp()))
        let thrown: unknown
        try {
            await resilientAbciQuery("vm/qrender", "gno.land/r/nodeerr-c:", true)
        } catch (err) { thrown = err }
        expect(thrown).toBeInstanceOf(Error)
        expect(thrown).not.toBeInstanceOf(AbciQueryError)
    })

    it("detailed: rejects (never kind=empty) on a top-level JSON-RPC error", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(rpcErrorResp()))
        await expect(resilientAbciQueryDetailed("vm/qrender", "gno.land/r/nodeerr-d:")).rejects.toThrow(/catching up/)
    })
})

// Mainnet (`gnoland-1`) gained its first fallback on 2026-09-23: Samourai's own
// node, identity-verified. Hermetic: the module graph is re-imported under a
// stubbed default so a local .env pinning another chain cannot skew it.
describe("mainnet failover to the verified fallback node", () => {
    afterEach(() => {
        vi.unstubAllEnvs()
        vi.resetModules()
        window.history.replaceState({}, "", "/")
    })

    it("orders rpc.gno.land first, then rpc.mainnet.samourai.live, and fails over to it", async () => {
        vi.stubEnv("VITE_GNO_CHAIN_ID", "mainnet")
        window.history.replaceState({}, "", "/mainnet/")
        vi.resetModules()
        const rf = await import("./rpcFallback")
        expect(rf.getRpcUrlsInOrder()).toEqual([
            "https://rpc.gno.land:443",
            "https://rpc.mainnet.samourai.live:443",
        ])

        const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
            const url = String(input)
            if (url.startsWith("https://rpc.gno.land")) throw new TypeError("Failed to fetch")
            return okData("from fallback")
        })
        vi.stubGlobal("fetch", fetchMock)

        await expect(rf.resilientAbciQuery("vm/qrender", "gno.land/r/x:")).resolves.toBe("from fallback")
        expect(fetchMock.mock.calls.some(([u]) => String(u).startsWith("https://rpc.mainnet.samourai.live"))).toBe(true)
        // The working fallback is tried first for the rest of the session.
        expect(rf.getRpcUrlsInOrder()[0]).toBe("https://rpc.mainnet.samourai.live:443")
    })
})

// gnolang/gno#6413: an operator can set rpc.allow_code_execution=false, and the
// node then refuses vm/qeval, vm/qrender and .app/simulate — HTTP 200 with a
// TOP-LEVEL JSON-RPC error on a POST, HTTP 403 on a GET. That is one node
// refusing, not the chain answering: fail over to the next endpoint, and only
// when every endpoint refuses surface a clear error to every caller. The realm's
// own error (ResponseBase.Error) is the same on every node: no failover.
describe("refused code-running queries fail over to the next endpoint", () => {
    const PRIMARY = "https://rpc.gno.land"
    const FALLBACK = "https://rpc.mainnet.samourai.live"
    const refusedResp = () => ({
        ok: true,
        status: 200,
        json: async () => ({ jsonrpc: "2.0", id: "memba-dao", error: { code: -32603, message: "code execution is disabled on this node" } }),
    })
    const forbiddenResp = () => ({ ok: false, status: 403, json: async () => ({}) })
    const panicResp = () => ({
        ok: true,
        status: 200,
        json: async () => ({ result: { response: { ResponseBase: { Error: { "@type": "/vm.VMError" }, Log: "panic: division by zero", Data: null } } } }),
    })

    // Hermetic two-node mainnet list (same pattern as the mainnet failover suite),
    // re-imported per test so the remembered working node never leaks.
    async function mainnet() {
        vi.stubEnv("VITE_GNO_CHAIN_ID", "mainnet")
        window.history.replaceState({}, "", "/mainnet/")
        vi.resetModules()
        const rf = await import("./rpcFallback")
        expect(rf.getRpcUrlsInOrder().map((u) => u.replace(/:443$/, ""))).toEqual([PRIMARY, FALLBACK])
        return rf
    }
    function byNode(primary: () => unknown, fallback: () => unknown) {
        return vi.fn(async (input: RequestInfo | URL) => (String(input).startsWith(PRIMARY) ? primary() : fallback()))
    }
    const callsTo = (mock: ReturnType<typeof vi.fn>, node: string) => mock.mock.calls.filter(([u]) => String(u).startsWith(node)).length

    afterEach(() => {
        vi.unstubAllEnvs()
        vi.resetModules()
        window.history.replaceState({}, "", "/")
    })

    it("HTTP 200 + top-level JSON-RPC error on node 1 → the result comes from node 2", async () => {
        const rf = await mainnet()
        const fetchMock = byNode(refusedResp, () => okData("(42 int)"))
        vi.stubGlobal("fetch", fetchMock)

        await expect(rf.resilientAbciQueryDetailed("vm/qeval", "gno.land/r/x.Answer()")).resolves.toEqual({ kind: "ok", text: "(42 int)" })
        expect(callsTo(fetchMock, PRIMARY)).toBe(1) // a refusal is not retried on the same node
        expect(callsTo(fetchMock, FALLBACK)).toBe(1)
        // The node that answered is preferred for the rest of the session.
        expect(rf.getRpcUrlsInOrder()[0].startsWith(FALLBACK)).toBe(true)
    })

    it("HTTP 403 on node 1 → the result comes from node 2", async () => {
        const rf = await mainnet()
        const fetchMock = byNode(forbiddenResp, () => okData("# rendered"))
        vi.stubGlobal("fetch", fetchMock)

        await expect(rf.resilientAbciQuery("vm/qrender", "gno.land/r/x:", true)).resolves.toBe("# rendered")
        expect(callsTo(fetchMock, PRIMARY)).toBe(1)
    })

    it("every node refuses → strict callers get RpcRefusedError naming the refusal", async () => {
        const rf = await mainnet()
        vi.stubGlobal("fetch", byNode(refusedResp, forbiddenResp))

        let thrown: unknown
        try { await rf.resilientAbciQuery("vm/qeval", "gno.land/r/x.Answer()", true) } catch (err) { thrown = err }
        expect(thrown).toBeInstanceOf(rf.RpcRefusedError)
        expect(thrown).not.toBeInstanceOf(rf.AbciQueryError) // never "not deployed here"
        const err = thrown as InstanceType<typeof rf.RpcRefusedError>
        expect(err.message).toMatch(/refused by every reachable RPC endpoint/)
        expect(err.message).toMatch(/vm\/qeval/)
        expect(err.message).toMatch(/code execution is disabled/)
        expect(err.message).toMatch(/HTTP 403/)
        expect(err.refusals).toHaveLength(2)
    })

    it("every node refuses → non-strict callers are rejected too, never handed a silent null", async () => {
        const rf = await mainnet()
        vi.stubGlobal("fetch", byNode(refusedResp, refusedResp))

        await expect(rf.resilientAbciQuery("vm/qrender", "gno.land/r/x:", false)).rejects.toThrow(rf.RpcRefusedError)
        await expect(rf.resilientAbciQueryDetailed("vm/qrender", "gno.land/r/x:")).rejects.toThrow(rf.RpcRefusedError)
    })

    it("one node refuses and the other is down → still reported as a refusal, not a null", async () => {
        const rf = await mainnet()
        vi.stubGlobal("fetch", byNode(refusedResp, () => { throw new TypeError("Failed to fetch") }))

        await expect(rf.resilientAbciQuery("vm/qrender", "gno.land/r/x:", false)).rejects.toThrow(rf.RpcRefusedError)
    })

    it("every node down (no refusal) keeps the old contract: strict throws, non-strict null", async () => {
        const rf = await mainnet()
        vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")))

        await expect(rf.resilientAbciQuery("vm/qrender", "gno.land/r/x:", false)).resolves.toBeNull()
        const strict = rf.resilientAbciQuery("vm/qrender", "gno.land/r/y:", true)
        await expect(strict).rejects.toThrow(/Failed to fetch/)
        await expect(strict).rejects.not.toBeInstanceOf(rf.RpcRefusedError)
    })

    it("a realm-level ABCI error (panic in the evaluated expression) does NOT fail over", async () => {
        const rf = await mainnet()
        const fetchMock = byNode(panicResp, () => okData("must not be read"))
        vi.stubGlobal("fetch", fetchMock)

        const res = await rf.resilientAbciQueryDetailed("vm/qeval", "gno.land/r/x.Divide(1, 0)")
        expect(res.kind).toBe("abci-error")
        if (res.kind === "abci-error") expect(res.error.log).toMatch(/division by zero/)
        expect(callsTo(fetchMock, FALLBACK)).toBe(0)
        await expect(rf.resilientAbciQuery("vm/qeval", "gno.land/r/x.Divide(1, 0)", true)).rejects.toThrow(rf.AbciQueryError)
    })
})
