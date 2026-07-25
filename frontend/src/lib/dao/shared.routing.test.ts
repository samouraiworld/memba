/**
 * B-4 routing tests: dao/shared.abciQuery must honor its rpcUrl argument.
 *
 * Before B-4 the argument was discarded — queryRender("https://other", …)
 * silently queried the ACTIVE network's resilient chain, so the CAL's
 * per-network config.rpcUrl had no effect on any read that flowed through
 * shared.ts. These tests pin both lanes through the REAL rpcFallback module
 * (fetch stubbed), and the registry tripwire that keeps the active network on
 * the resilient lane.
 */
import { describe, it, expect, vi, afterEach } from "vitest"
import { queryRender, queryEval } from "./shared"
import { GNO_RPC_URL, ACTIVE_NETWORK_KEY } from "../config"
import { isActivePrimaryRpcUrl } from "../rpcFallback"
import { ALL_NETWORKS } from "../chain/registry"
import { configKeyToChainId } from "../chain/gnoBridge"

const okData = (text: string) => ({
    ok: true,
    json: async () => ({ result: { response: { ResponseBase: { Data: btoa(text) } } } }),
})

afterEach(() => {
    vi.unstubAllGlobals()
})

describe("abciQuery routing on rpcUrl (B-4)", () => {
    it("routes an active-network read through the resilient chain (primary url first)", async () => {
        const fetchMock = vi.fn().mockResolvedValue(okData("# home"))
        vi.stubGlobal("fetch", fetchMock)
        await expect(queryRender(GNO_RPC_URL, "gno.land/r/demo/x", "")).resolves.toBe("# home")
        expect(fetchMock.mock.calls[0][0]).toBe(GNO_RPC_URL)
    })

    it("routes a divergent endpoint to EXACTLY that endpoint — never the primary", async () => {
        const OTHER = "https://rpc.some-other-chain.example"
        const fetchMock = vi.fn().mockResolvedValue(okData("# other"))
        vi.stubGlobal("fetch", fetchMock)
        await expect(queryEval(OTHER, "gno.land/r/demo/x", "GetX()")).resolves.toBe("# other")
        expect(fetchMock).toHaveBeenCalledTimes(1)
        expect(fetchMock.mock.calls[0][0]).toBe(OTHER)
    })

    it("a divergent endpoint's failure never falls over to the primary chain", async () => {
        const OTHER = "https://rpc.some-other-chain.example"
        const fetchMock = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"))
        vi.stubGlobal("fetch", fetchMock)
        await expect(queryRender(OTHER, "gno.land/r/demo/x", "")).resolves.toBeNull()
        for (const call of fetchMock.mock.calls) expect(call[0]).toBe(OTHER)
    })
})

describe("registry↔config equality tripwire", () => {
    it("the registry-derived ACTIVE gno network's rpcUrl stays on the resilient lane", () => {
        // The CAL derives its gno networks from the same NETWORKS object
        // config.ts froze GNO_RPC_URL from, so for the active network the two
        // strings are identical and the CAL keeps full failover. If this ever
        // breaks (env override, normalization drift, a hand-written url), the
        // active network silently downgrades to the single-node lane — fail
        // loudly here instead.
        const activeChainId = configKeyToChainId(ACTIVE_NETWORK_KEY)
        const active = ALL_NETWORKS.find(n => n.family === "gno" && n.chainId === activeChainId)
        expect(active).toBeDefined()
        expect(active!.rpcUrl).toBe(GNO_RPC_URL)
        expect(isActivePrimaryRpcUrl(active!.rpcUrl)).toBe(true)
    })
})
