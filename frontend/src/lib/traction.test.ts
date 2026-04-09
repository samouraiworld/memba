import { describe, it, expect, vi, beforeEach } from "vitest"
import { fetchTractionMetrics } from "./traction"

// Mock sessionStorage
const store = new Map<string, string>()
vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
})

beforeEach(() => {
    store.clear()
    vi.restoreAllMocks()
})

describe("fetchTractionMetrics", () => {
    it("returns metrics with daoCount >= 0", async () => {
        vi.spyOn(globalThis, "fetch").mockResolvedValue(
            new Response(JSON.stringify([]), { status: 200 }),
        )

        const metrics = await fetchTractionMetrics()
        expect(metrics.daoCount).toBeGreaterThanOrEqual(0)
        expect(metrics.fetchedAt).toBeGreaterThan(0)
    })

    it("returns cached metrics on second call", async () => {
        vi.spyOn(globalThis, "fetch").mockResolvedValue(
            new Response(JSON.stringify([]), { status: 200 }),
        )

        const first = await fetchTractionMetrics()
        const second = await fetchTractionMetrics()
        expect(second.fetchedAt).toBe(first.fetchedAt)
    })

    it("handles fetch failures gracefully", async () => {
        vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network"))

        const metrics = await fetchTractionMetrics()
        expect(metrics.contributorCount).toBe(0)
        expect(metrics.repoCount).toBe(0)
    })

    it("parses contributor total from API response", async () => {
        // /stats returns { users: [...] }, /repositories returns [...], gnoweb returns HTML
        const mockUsers = Array.from({ length: 42 }, (_, i) => ({ login: `user${i}` }))
        vi.spyOn(globalThis, "fetch")
            .mockResolvedValueOnce(new Response(JSON.stringify({ users: mockUsers }), { status: 200 }))
            .mockResolvedValueOnce(new Response(JSON.stringify([{ name: "repo1" }, { name: "repo2" }]), { status: 200 }))
            .mockResolvedValueOnce(new Response("", { status: 200 })) // gnoweb namespace query

        const metrics = await fetchTractionMetrics()
        expect(metrics.contributorCount).toBe(42)
        expect(metrics.repoCount).toBe(2)
    })
})
