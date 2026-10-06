import { describe, it, expect, vi, beforeEach } from "vitest"
import { checkChainHealth, getSuggestedFallback } from "./chainHealth"

// Mock NETWORKS used by chainHealth
//
// DELIBERATE DIVERGENCE FROM REALITY: no entry carries `hidden`, even though the
// real test13 and pearl do. getSuggestedFallback filters on `!net.hidden` AND
// on Memba having realms there; each clause is isolated by one test below
// (hiding mainnet, or emptying its allowlist), so neither can go unnoticed.
const realms = vi.hoisted(() => ({ mainnetAllowlisted: true }))
vi.mock("./config", () => ({
    // Mirror the real predicates. Mainnet's wave 1 is partial: `realmsDeployed:
    // false` with a non-empty REALM_ALLOWLIST, so it is suggestable ONLY
    // through the allowlist clause.
    networkHasRealms: (k: string) => ({ test13: true, pearl: true, mainnet: false })[k] ?? true,
    networkHasAllowlistedRealms: (k: string) => (k === "mainnet" ? realms.mainnetAllowlisted : false),
    NETWORKS: {
        mainnet: {
            chainId: "gnoland-1",
            rpcUrl: "https://rpc.gno.land:443",
            fallbackRpcUrls: [],
            label: "gno.land",
        },
        pearl: {
            chainId: "pearl-1",
            rpcUrl: "https://rpc.pearl.testnets.gno.land:443",
            fallbackRpcUrls: ["https://rpc.pearl.samourai.live:443"],
            label: "Pearl",
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

            const result = await checkChainHealth("test13", 500)
            expect(result.reachable).toBe(false)
            expect(result.respondingRpc).toBeNull()
            expect(result.chainId).toBe("test-13")
        })

        it("queries all fallback RPCs", async () => {
            const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("timeout"))

            await checkChainHealth("test13", 500)

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
                            node_info: { network: "test-13" },
                            sync_info: { latest_block_height: "500" },
                        },
                    }),
                } as Response)
            })

            const result = await checkChainHealth("test13", 2000)
            expect(result.reachable).toBe(true)
            expect(result.blockHeight).toBe(500)
        })
    })

    describe("getSuggestedFallback", () => {
        it("suggests mainnet (Memba realms live) from test13", () => {
            // Retired test13 and pearl are not in the fallback order at all.
            expect(getSuggestedFallback("test13")).toBe("mainnet")
        })

        it("offers mainnet as the escape from a dead pearl deep link", () => {
            expect(getSuggestedFallback("pearl")).toBe("mainnet")
        })

        it("never suggests the retired or outgoing chains", () => {
            for (const from of ["mainnet", "pearl", "unknown", "test13"]) {
                expect(getSuggestedFallback(from)).not.toBe("test13")
                // pearl left the order at the 2026-09-23 mainnet cutover — a
                // shut-down chain must never be offered as an escape.
                expect(getSuggestedFallback(from)).not.toBe("pearl")
            }
        })

        it("suggests mainnet for unknown network", () => {
            expect(getSuggestedFallback("unknown")).toBe("mainnet")
        })
    })
})

describe("getSuggestedFallback never steers into a dead end", () => {
    it("returns null when mainnet itself is the degraded one: never suggests self", () => {
        expect(getSuggestedFallback("mainnet")).toBeNull()
    })

    it("never suggests a network where Memba has no realms", () => {
        // Isolates the realm half of the filter: mainnet is visible and not the
        // current network, so only the realm check can reject it.
        realms.mainnetAllowlisted = false
        try {
            expect(getSuggestedFallback("test13")).toBeNull()
        } finally {
            realms.mainnetAllowlisted = true
        }
        expect(getSuggestedFallback("test13")).toBe("mainnet")
    })

    it("never suggests a HIDDEN network, even one whose realms are deployed", async () => {
        // Isolates the `!net.hidden` half of the filter. Suggesting a hidden
        // network is a dead end: it is absent from the switcher, so a user sent
        // there by the banner could only leave via the active-network escape
        // hatch. mainnet has allowlisted realms in this mock, so the realm
        // filter cannot be what rejects it — only `!net.hidden` can.
        const { NETWORKS } = await import("./config") as { NETWORKS: Record<string, { hidden?: boolean }> }
        NETWORKS.mainnet.hidden = true
        try {
            expect(getSuggestedFallback("test13")).toBeNull()
        } finally {
            delete NETWORKS.mainnet.hidden
        }
        // …and the suggestion comes back once it is visible again.
        expect(getSuggestedFallback("test13")).toBe("mainnet")
    })
})
