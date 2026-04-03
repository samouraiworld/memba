import { describe, it, expect, vi, beforeEach } from "vitest"
import { checkChainHealth, getSuggestedFallback } from "./chainHealth"

// Mock NETWORKS used by chainHealth
vi.mock("./config", () => ({
    NETWORKS: {
        test12: {
            chainId: "test12",
            rpcUrl: "https://rpc.testnet12.samourai.live:443",
            fallbackRpcUrls: [],
            label: "Testnet 12",
        },
        gnoland1: {
            chainId: "gnoland1",
            rpcUrl: "https://rpc.gnoland1.samourai.live:443",
            fallbackRpcUrls: [
                "https://rpc.gnoland1.moul.p2p.team",
                "https://rpc.gnoland1.aeddi.org",
            ],
            label: "Betanet (gnoland1)",
        },
        "portal-loop": {
            chainId: "portal-loop",
            rpcUrl: "https://rpc.gno.land:443",
            fallbackRpcUrls: [],
            label: "Portal Loop",
        },
    },
}))

describe("chainHealth", () => {
    beforeEach(() => {
        vi.restoreAllMocks()
    })

    describe("checkChainHealth", () => {
        it("returns reachable=false for unknown network key", async () => {
            const result = await checkChainHealth("nonexistent", 100)
            expect(result.reachable).toBe(false)
            expect(result.respondingRpc).toBeNull()
            expect(result.chainId).toBe("nonexistent")
        })

        it("returns reachable=true when fetch succeeds", async () => {
            const mockResponse = {
                ok: true,
                json: () => Promise.resolve({
                    result: {
                        node_info: { network: "test12" },
                        sync_info: { latest_block_height: "218000" },
                    },
                }),
            }
            vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResponse as Response)

            const result = await checkChainHealth("test12", 1000)
            expect(result.reachable).toBe(true)
            expect(result.blockHeight).toBe(218000)
            expect(result.chainId).toBe("test12")
            expect(result.latencyMs).toBeGreaterThanOrEqual(0)
        })

        it("returns reachable=false when all RPCs fail", async () => {
            vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network error"))

            const result = await checkChainHealth("gnoland1", 500)
            expect(result.reachable).toBe(false)
            expect(result.respondingRpc).toBeNull()
            expect(result.chainId).toBe("gnoland1")
        })

        it("queries all fallback RPCs for gnoland1", async () => {
            const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("timeout"))

            await checkChainHealth("gnoland1", 500)

            // Should have called fetch for primary + 2 fallbacks = 3 URLs
            expect(fetchSpy.mock.calls.length).toBe(3)
        })

        it("succeeds if any fallback responds", async () => {
            let callIndex = 0
            vi.spyOn(globalThis, "fetch").mockImplementation(() => {
                callIndex++
                // First call (primary) fails, second (fallback) succeeds
                if (callIndex <= 1) return Promise.reject(new Error("timeout"))
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        result: {
                            node_info: { network: "gnoland1" },
                            sync_info: { latest_block_height: "500" },
                        },
                    }),
                } as Response)
            })

            const result = await checkChainHealth("gnoland1", 2000)
            expect(result.reachable).toBe(true)
            expect(result.blockHeight).toBe(500)
        })
    })

    describe("getSuggestedFallback", () => {
        it("suggests test12 for gnoland1", () => {
            expect(getSuggestedFallback("gnoland1")).toBe("test12")
        })

        it("suggests portal-loop for test12", () => {
            expect(getSuggestedFallback("test12")).toBe("portal-loop")
        })

        it("suggests test12 for unknown network", () => {
            expect(getSuggestedFallback("unknown")).toBe("test12")
        })

        it("does not suggest self", () => {
            const fallback = getSuggestedFallback("test12")
            expect(fallback).not.toBe("test12")
        })
    })
})
