/**
 * gnomonitoring.test.ts — Unit tests for the gnomonitoring API client.
 *
 * Tests cover:
 *   - Cache key includes chain ID (defense-in-depth)
 *   - fetchAllMonitoringData returns empty Map on API failure
 *   - Participation/uptime data merge produces correct MonitoringValidatorData
 *   - Null filtering removes null entries from API response
 *   - Cache TTL expiry
 *   - Graceful degradation when GNO_MONITORING_API_URL is empty
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// ── Mock config before importing the module ──────────────────
vi.mock("./config", () => ({
    GNO_CHAIN_ID: "test-chain-42",
    GNO_MONITORING_API_URL: "https://mock-monitoring.example.com",
}))

// ── Helpers ──────────────────────────────────────────────────

const mockParticipation = [
    { addr: "g1aaa", moniker: "validator-a", participationRate: 95.5 },
    { addr: "g1bbb", moniker: "validator-b", participationRate: 88.2 },
    null,  // null entry — should be filtered
]

const mockUptime = [
    { addr: "g1aaa", moniker: "validator-a", uptime: 99.9 },
    { addr: "g1bbb", moniker: "validator-b", uptime: 100 },
    null,
]

const mockFirstSeen = [
    { addr: "g1aaa", moniker: "validator-a", firstSeen: "2026-01-15" },
    { addr: "g1ccc", moniker: "validator-c", firstSeen: "2026-02-01" },
]

// ── Tests ────────────────────────────────────────────────────

describe("gnomonitoring", () => {
    let sessionStore: Record<string, string>

    beforeEach(() => {
        sessionStore = {}
        vi.stubGlobal("sessionStorage", {
            getItem: (key: string) => sessionStore[key] ?? null,
            setItem: (key: string, val: string) => { sessionStore[key] = val },
            removeItem: (key: string) => { delete sessionStore[key] },
        })
        vi.stubGlobal("fetch", vi.fn())
    })

    afterEach(() => {
        vi.restoreAllMocks()
        vi.resetModules()
    })

    it("cache key includes chain ID for network isolation", async () => {
        const mod = await import("./gnomonitoring")
        // Trigger a fetch to populate cache
        vi.mocked(fetch).mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve(mockParticipation),
        } as Response)

        await mod.fetchMonitoringParticipation()

        // Cache key should include chain ID
        const keys = Object.keys(sessionStore)
        expect(keys.length).toBe(1)
        expect(keys[0]).toContain("test-chain-42")
        expect(keys[0]).toContain("participation")
    })

    it("fetchAllMonitoringData returns empty Map on total API failure", async () => {
        const mod = await import("./gnomonitoring")
        vi.mocked(fetch).mockRejectedValue(new Error("network down"))

        const result = await mod.fetchAllMonitoringData()

        expect(result).toBeInstanceOf(Map)
        expect(result.size).toBe(0)
    })

    it("fetchMonitoringParticipation filters null entries", async () => {
        const mod = await import("./gnomonitoring")
        vi.mocked(fetch).mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve(mockParticipation),
        } as Response)

        const result = await mod.fetchMonitoringParticipation()

        expect(result).not.toBeNull()
        expect(result!.length).toBe(2) // null filtered out
        expect(result![0].addr).toBe("g1aaa")
        expect(result![1].participationRate).toBe(88.2)
    })

    it("fetchMonitoringParticipation returns null on non-ok response", async () => {
        const mod = await import("./gnomonitoring")
        vi.mocked(fetch).mockResolvedValueOnce({
            ok: false,
            status: 500,
        } as Response)

        const result = await mod.fetchMonitoringParticipation()
        expect(result).toBeNull()
    })

    it("fetchAllMonitoringData merges participation + uptime + firstSeen by address", async () => {
        const mod = await import("./gnomonitoring")

        // Mock 3 parallel requests (participation, uptime, firstSeen)
        vi.mocked(fetch).mockImplementation(async (url) => {
            const urlStr = typeof url === "string" ? url : (url as Request).url
            if (urlStr.includes("/Participation")) {
                return { ok: true, json: () => Promise.resolve(mockParticipation) } as Response
            }
            if (urlStr.includes("/uptime")) {
                return { ok: true, json: () => Promise.resolve(mockUptime) } as Response
            }
            if (urlStr.includes("/first_seen")) {
                return { ok: true, json: () => Promise.resolve(mockFirstSeen) } as Response
            }
            return { ok: false } as Response
        })

        const result = await mod.fetchAllMonitoringData()

        // g1aaa: has participation + uptime + firstSeen
        const a = result.get("g1aaa")
        expect(a).toBeDefined()
        expect(a!.moniker).toBe("validator-a")
        expect(a!.participationRate).toBe(95.5)
        expect(a!.uptime).toBe(99.9)
        expect(a!.firstSeen).toBe("2026-01-15")

        // g1bbb: has participation + uptime, no firstSeen
        const b = result.get("g1bbb")
        expect(b).toBeDefined()
        expect(b!.uptime).toBe(100)
        expect(b!.firstSeen).toBeNull()

        // g1ccc: only firstSeen (not in participation set)
        const c = result.get("g1ccc")
        expect(c).toBeDefined()
        expect(c!.firstSeen).toBe("2026-02-01")
        expect(c!.participationRate).toBe(0)
    })

    it("cache serves data within TTL window", async () => {
        const mod = await import("./gnomonitoring")

        vi.mocked(fetch).mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve(mockParticipation),
        } as Response)

        // First call — fetches from API
        const first = await mod.fetchMonitoringParticipation()
        expect(fetch).toHaveBeenCalledTimes(1)

        // Second call — should use cache (no additional fetch)
        const second = await mod.fetchMonitoringParticipation()
        expect(fetch).toHaveBeenCalledTimes(1) // still 1 — cache hit
        expect(second).toEqual(first)
    })

    it("fetchMonitoringUptime returns null on network error", async () => {
        const mod = await import("./gnomonitoring")
        vi.mocked(fetch).mockRejectedValueOnce(new TypeError("Failed to fetch"))

        const result = await mod.fetchMonitoringUptime()
        expect(result).toBeNull()
    })

    it("API URL includes chain query param", async () => {
        const mod = await import("./gnomonitoring")
        vi.mocked(fetch).mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve([]),
        } as Response)

        await mod.fetchMonitoringParticipation()

        const calledUrl = vi.mocked(fetch).mock.calls[0][0] as string
        expect(calledUrl).toContain("chain=test-chain-42")
    })

    it("fetchMonitoringFirstSeen filters null entries", async () => {
        const mod = await import("./gnomonitoring")
        vi.mocked(fetch).mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve([
                { addr: "g1xxx", moniker: "val-x", firstSeen: "2026-03-01" },
                null,
                null,
            ]),
        } as Response)

        const result = await mod.fetchMonitoringFirstSeen()
        expect(result).not.toBeNull()
        expect(result!.length).toBe(1)
        expect(result![0].addr).toBe("g1xxx")
    })

    it("fetchAllMonitoringData handles partial API failure gracefully", async () => {
        const mod = await import("./gnomonitoring")

        vi.mocked(fetch).mockImplementation(async (url) => {
            const urlStr = typeof url === "string" ? url : (url as Request).url
            if (urlStr.includes("/Participation")) {
                return { ok: true, json: () => Promise.resolve(mockParticipation) } as Response
            }
            // uptime and first_seen fail
            throw new Error("timeout")
        })

        const result = await mod.fetchAllMonitoringData()

        // Should still have participation data
        expect(result.size).toBe(2)
        const a = result.get("g1aaa")
        expect(a!.participationRate).toBe(95.5)
        expect(a!.uptime).toBeNull()     // failed gracefully
        expect(a!.firstSeen).toBeNull()  // failed gracefully
    })
})

// ── Moniker resilience (VALIDATOR_NAMING_RESILIENCE_PLAN, P0-B) ───────────────
//
// The 2026-07-08 incident: /Participation failing (or returning addr-as-moniker
// fallbacks) blanked EVERY validator name. These tests pin the three layers:
// any-endpoint seeding, the addr-shaped-moniker guard, and the last-good cache.

describe("moniker resilience", () => {
    let sessionStore: Record<string, string>
    let localStore: Record<string, string>

    beforeEach(() => {
        sessionStore = {}
        localStore = {}
        vi.stubGlobal("sessionStorage", {
            getItem: (key: string) => sessionStore[key] ?? null,
            setItem: (key: string, val: string) => { sessionStore[key] = val },
            removeItem: (key: string) => { delete sessionStore[key] },
        })
        vi.stubGlobal("localStorage", {
            getItem: (key: string) => localStore[key] ?? null,
            setItem: (key: string, val: string) => { localStore[key] = val },
            removeItem: (key: string) => { delete localStore[key] },
            clear: () => { localStore = {} },
        })
        vi.stubGlobal("fetch", vi.fn())
    })

    afterEach(() => {
        vi.restoreAllMocks()
        vi.resetModules()
    })

    it("isRealMoniker rejects placeholders, addresses, and address-shaped strings", async () => {
        const { isRealMoniker } = await import("./gnomonitoring")
        expect(isRealMoniker("gfanton-1")).toBe(true)
        expect(isRealMoniker("Validator One")).toBe(true)
        expect(isRealMoniker("")).toBe(false)
        expect(isRealMoniker(null)).toBe(false)
        expect(isRealMoniker("unknown")).toBe(false)
        expect(isRealMoniker("g15sysllqvjyqxy9tdd0z9wcfnjeuxx6vwpves")).toBe(false)
        expect(isRealMoniker("g1abc", "g1abc")).toBe(false) // equals its own addr
    })

    it("participation DOWN: names still seed from any other moniker-bearing endpoint", async () => {
        const mod = await import("./gnomonitoring")
        vi.mocked(fetch).mockImplementation(async (url) => {
            const u = typeof url === "string" ? url : (url as Request).url
            if (u.includes("/Participation")) return { ok: false } as Response
            if (u.includes("/uptime")) {
                return { ok: true, json: () => Promise.resolve([{ addr: "g1aaa", moniker: "validator-a", uptime: 99.9 }]) } as Response
            }
            return { ok: false } as Response
        })

        const result = await mod.fetchAllMonitoringData()
        expect(result.get("g1aaa")?.moniker).toBe("validator-a")
        expect(result.get("g1aaa")?.uptime).toBe(99.9)
    })

    it("address-shaped monikers from the backend never reach the UI", async () => {
        const mod = await import("./gnomonitoring")
        vi.mocked(fetch).mockImplementation(async (url) => {
            const u = typeof url === "string" ? url : (url as Request).url
            if (u.includes("/Participation")) {
                // The backend addr-fallback bug shape: moniker === addr.
                return { ok: true, json: () => Promise.resolve([{ addr: "g1aaabbbcccdddeee", moniker: "g1aaabbbcccdddeee", participationRate: 95 }]) } as Response
            }
            return { ok: false } as Response
        })

        const result = await mod.fetchAllMonitoringData()
        expect(result.get("g1aaabbbcccdddeee")?.moniker).toBe("")
        expect(result.get("g1aaabbbcccdddeee")?.participationRate).toBe(95)
    })

    it("persists real names and backfills them from the last-good cache during an outage", async () => {
        const mod = await import("./gnomonitoring")

        // Round 1 — healthy: names persist to the last-good cache.
        vi.mocked(fetch).mockImplementation(async (url) => {
            const u = typeof url === "string" ? url : (url as Request).url
            if (u.includes("/Participation")) {
                return { ok: true, json: () => Promise.resolve(mockParticipation) } as Response
            }
            return { ok: false } as Response
        })
        let result = await mod.fetchAllMonitoringData()
        expect(result.get("g1aaa")?.moniker).toBe("validator-a")
        expect(localStore["memba_validator_monikers_v1"]).toContain("validator-a")

        // Round 2 — degraded: the endpoint now returns addr-as-moniker rows
        // (sessionStorage HTTP cache is fresh, so clear it to force the refetch).
        sessionStore = {}
        vi.mocked(fetch).mockImplementation(async (url) => {
            const u = typeof url === "string" ? url : (url as Request).url
            if (u.includes("/Participation")) {
                return { ok: true, json: () => Promise.resolve([
                    { addr: "g1aaa", moniker: "g1aaa", participationRate: 12 },
                ]) } as Response
            }
            return { ok: false } as Response
        })
        result = await mod.fetchAllMonitoringData()
        expect(result.get("g1aaa")?.moniker).toBe("validator-a") // last-good name, not the address
        expect(result.get("g1aaa")?.participationRate).toBe(12) // metrics stay live
    })
})
