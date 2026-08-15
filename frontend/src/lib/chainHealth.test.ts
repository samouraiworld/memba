import { describe, it, expect, vi, beforeEach } from "vitest"
import { checkChainHealth, getSuggestedFallback } from "./chainHealth"

// Mock NETWORKS used by chainHealth
//
// DELIBERATE DIVERGENCE FROM REALITY: no entry carries `hidden`, even though the
// real gnoland1, test13 and (since 2026-08-12) topaz all do. getSuggestedFallback
// filters on BOTH `!net.hidden` AND `networkHasRealms(key)`; if the mock's
// gnoland1 were also hidden, deleting either clause would still leave it
// filtered by the other and the suite would pass with half the fix gone.
// Keeping the mock's gnoland1 realm-less-but-visible isolates the
// `networkHasRealms` clause, and the "hidden networks are never suggested" case
// below isolates `!net.hidden` by hiding sapphire for the duration of one test.
vi.mock("./config", () => ({
    // getSuggestedFallback now refuses to steer users to a chain with no Memba
    // realms (its comment always said so; the code did not). Mirror the real
    // predicate: realmsDeployed !== false.
    networkHasRealms: (k: string) => ({ test13: true, topaz: true, sapphire: true, gnoland1: false })[k] ?? true,
    NETWORKS: {
        sapphire: {
            chainId: "sapphire-1",
            rpcUrl: "https://rpc.sapphire.testnets.gno.land:443",
            fallbackRpcUrls: ["https://sapphire.rpc.onbloc.xyz:443"],
            label: "Sapphire",
        },
        test13: {
            chainId: "test-13",
            rpcUrl: "https://rpc.test13.testnets.gno.land:443",
            fallbackRpcUrls: [
                "https://test13.rpc.onbloc.xyz:443",
                "https://rpc.test-13-aeddi-1.gnoland.network:443",
            ],
            label: "Testnet 13",
        },
        topaz: {
            chainId: "topaz-1",
            rpcUrl: "https://rpc.topaz.testnets.gno.land:443",
            fallbackRpcUrls: ["https://topaz.rpc.onbloc.xyz:443"],
            label: "Topaz",
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
                        node_info: { network: "test-13" },
                        sync_info: { latest_block_height: "218000" },
                    },
                }),
            }
            vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResponse as Response)

            const result = await checkChainHealth("test13", 1000)
            expect(result.reachable).toBe(true)
            expect(result.blockHeight).toBe(218000)
            expect(result.chainId).toBe("test-13")
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
        it("suggests sapphire for gnoland1", () => {
            expect(getSuggestedFallback("gnoland1")).toBe("sapphire")
        })

        it("suggests sapphire (Memba realms live) for test13, not Betanet", () => {
            // sapphire carries the core realm set; gnoland1 (Betanet) has no
            // Memba realms and must never be the first suggestion. Retired
            // test13 and topaz are no longer in the fallback order at all.
            expect(getSuggestedFallback("test13")).toBe("sapphire")
        })

        it("never suggests the retired chains", () => {
            for (const from of ["sapphire", "unknown", "gnoland1"]) {
                expect(getSuggestedFallback(from)).not.toBe("test13")
                expect(getSuggestedFallback(from)).not.toBe("topaz")
            }
        })

        it("suggests sapphire for unknown network", () => {
            expect(getSuggestedFallback("unknown")).toBe("sapphire")
        })

        it("does not suggest self", () => {
            const fallback = getSuggestedFallback("gnoland1")
            expect(fallback).not.toBe("gnoland1")
        })
    })
})

describe("getSuggestedFallback never steers into a realm-less chain", () => {
    it("returns null rather than suggesting Betanet when sapphire is the degraded one", () => {
        // The regression this guards (born as fallbackOrder=["topaz","gnoland1"]
        // in the topaz era): when the FIRST entry is itself the degraded
        // network, the walk must not fall through to a chain with no Memba
        // realms — ChainHaltedBanner would render a one-click switch into a
        // dead end. Combined with hiding Betanet, that click used to be
        // unrecoverable.
        expect(getSuggestedFallback("sapphire")).toBeNull()
    })

    it("still suggests sapphire from the realm-less chain itself", () => {
        expect(getSuggestedFallback("gnoland1")).toBe("sapphire")
    })

    it("never suggests a HIDDEN network, even one whose realms are deployed", async () => {
        // Isolates the `!net.hidden` half of the filter. Suggesting a hidden
        // network is a dead end: it is absent from the switcher, so a user sent
        // there by the banner could only leave via the active-network escape
        // hatch. sapphire has realms in this mock, so networkHasRealms cannot be
        // what rejects it — only `!net.hidden` can.
        const { NETWORKS } = await import("./config") as { NETWORKS: Record<string, { hidden?: boolean }> }
        NETWORKS.sapphire.hidden = true
        try {
            expect(getSuggestedFallback("gnoland1")).toBeNull()
        } finally {
            delete NETWORKS.sapphire.hidden
        }
        // …and the suggestion comes back once it is visible again.
        expect(getSuggestedFallback("gnoland1")).toBe("sapphire")
    })
})
