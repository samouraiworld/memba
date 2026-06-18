/**
 * useEcosystemCounts.test.ts
 *
 * Covers:
 * 1. Normal case — all sources return counts
 * 2. One source throws — that count is null, others still resolve (allSettled)
 * 3. Realm not valid on network — that count is null (no network call made)
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"
import React from "react"

// ── Module-level mocks (hoisted) ──────────────────────────────

vi.mock("../../lib/grc20", () => ({
    listFactoryTokens: vi.fn(),
}))

vi.mock("../../lib/agentRegistry", () => ({
    fetchAgents: vi.fn(),
}))

vi.mock("../../lib/validators", () => ({
    getValidators: vi.fn(),
}))

vi.mock("../../lib/traction", () => ({
    fetchTractionMetrics: vi.fn(),
}))

vi.mock("../../lib/launchpadReads", () => ({
    fetchCollectionList: vi.fn(),
}))

vi.mock("../../lib/config", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../../lib/config")>()
    return {
        ...actual,
        isTokenFactoryValid: vi.fn(() => true),
        isNftLaunchpadValid: vi.fn(() => true),
        isRealmValid: vi.fn(() => true),
    }
})

vi.mock("../useNetwork", () => ({
    useNetwork: vi.fn(() => ({
        networkKey: "test13",
        rpcUrl: "https://rpc.test13.gno.land",
    })),
}))

// ── Resolve mocked modules for per-test control ───────────────

const grc20Mod = await import("../../lib/grc20")
const agentMod = await import("../../lib/agentRegistry")
const validatorMod = await import("../../lib/validators")
const tractionMod = await import("../../lib/traction")
const launchpadMod = await import("../../lib/launchpadReads")
const configMod = await import("../../lib/config")

// ── Wrapper ───────────────────────────────────────────────────

function makeWrapper() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return function Wrapper({ children }: { children: ReactNode }) {
        return React.createElement(QueryClientProvider, { client }, children)
    }
}

// ── Helpers ───────────────────────────────────────────────────

function setupHappyPath() {
    vi.mocked(configMod.isTokenFactoryValid).mockReturnValue(true)
    vi.mocked(configMod.isNftLaunchpadValid).mockReturnValue(true)
    vi.mocked(configMod.isRealmValid).mockReturnValue(true)

    vi.mocked(grc20Mod.listFactoryTokens).mockResolvedValue(
        Array.from({ length: 3 }, (_, i) => ({
            name: `Token${i}`, symbol: `T${i}`, decimals: 6, totalSupply: "0", admin: "",
        })),
    )
    vi.mocked(agentMod.fetchAgents).mockResolvedValue(
        Array.from({ length: 2 }, (_, i) => ({ id: `agent-${i}` }) as never),
    )
    vi.mocked(validatorMod.getValidators).mockResolvedValue(
        Array.from({ length: 5 }, (_, i) => ({ address: `g1addr${i}` }) as never),
    )
    vi.mocked(tractionMod.fetchTractionMetrics).mockResolvedValue({
        daoCount: 7, contributorCount: 40, repoCount: 12, fetchedAt: Date.now(),
    })
    vi.mocked(launchpadMod.fetchCollectionList).mockResolvedValue(
        Array.from({ length: 4 }, (_, i) => ({ id: `col-${i}` }) as never),
    )
}

// ── Tests ─────────────────────────────────────────────────────

describe("useEcosystemCounts — happy path", () => {
    beforeEach(() => {
        vi.clearAllMocks()
        setupHappyPath()
    })

    it("resolves tokens count", async () => {
        const { useEcosystemCounts } = await import("./useEcosystemCounts")
        const { result } = renderHook(() => useEcosystemCounts(), { wrapper: makeWrapper() })
        await waitFor(() => expect(result.current.loading).toBe(false))
        expect(result.current.tokens).toBe(3)
    })

    it("resolves agents count", async () => {
        const { useEcosystemCounts } = await import("./useEcosystemCounts")
        const { result } = renderHook(() => useEcosystemCounts(), { wrapper: makeWrapper() })
        await waitFor(() => expect(result.current.loading).toBe(false))
        expect(result.current.agents).toBe(2)
    })

    it("resolves validators count", async () => {
        const { useEcosystemCounts } = await import("./useEcosystemCounts")
        const { result } = renderHook(() => useEcosystemCounts(), { wrapper: makeWrapper() })
        await waitFor(() => expect(result.current.loading).toBe(false))
        expect(result.current.validators).toBe(5)
    })

    it("resolves daos count", async () => {
        const { useEcosystemCounts } = await import("./useEcosystemCounts")
        const { result } = renderHook(() => useEcosystemCounts(), { wrapper: makeWrapper() })
        await waitFor(() => expect(result.current.loading).toBe(false))
        expect(result.current.daos).toBe(7)
    })

    it("resolves collections count", async () => {
        const { useEcosystemCounts } = await import("./useEcosystemCounts")
        const { result } = renderHook(() => useEcosystemCounts(), { wrapper: makeWrapper() })
        await waitFor(() => expect(result.current.loading).toBe(false))
        expect(result.current.collections).toBe(4)
    })
})

describe("useEcosystemCounts — allSettled isolation (one source throws)", () => {
    beforeEach(() => {
        vi.clearAllMocks()
        setupHappyPath()
    })

    it("tokens null if listFactoryTokens throws; others still resolve", async () => {
        vi.mocked(grc20Mod.listFactoryTokens).mockRejectedValue(new Error("RPC error"))

        const { useEcosystemCounts } = await import("./useEcosystemCounts")
        const { result } = renderHook(() => useEcosystemCounts(), { wrapper: makeWrapper() })
        await waitFor(() => expect(result.current.loading).toBe(false))
        expect(result.current.tokens).toBeNull()
        // Siblings must still resolve
        expect(result.current.agents).toBe(2)
        expect(result.current.validators).toBe(5)
        expect(result.current.daos).toBe(7)
        expect(result.current.collections).toBe(4)
    })

    it("agents null if fetchAgents throws; others still resolve", async () => {
        vi.mocked(agentMod.fetchAgents).mockRejectedValue(new Error("network fail"))

        const { useEcosystemCounts } = await import("./useEcosystemCounts")
        const { result } = renderHook(() => useEcosystemCounts(), { wrapper: makeWrapper() })
        await waitFor(() => expect(result.current.loading).toBe(false))
        expect(result.current.agents).toBeNull()
        expect(result.current.tokens).toBe(3)
        expect(result.current.validators).toBe(5)
    })

    it("validators null if getValidators throws; others still resolve", async () => {
        vi.mocked(validatorMod.getValidators).mockRejectedValue(new Error("consensus down"))

        const { useEcosystemCounts } = await import("./useEcosystemCounts")
        const { result } = renderHook(() => useEcosystemCounts(), { wrapper: makeWrapper() })
        await waitFor(() => expect(result.current.loading).toBe(false))
        expect(result.current.validators).toBeNull()
        expect(result.current.tokens).toBe(3)
        expect(result.current.daos).toBe(7)
    })
})

describe("useEcosystemCounts — network gating", () => {
    beforeEach(() => {
        vi.clearAllMocks()
        setupHappyPath()
    })

    it("tokens is null when isTokenFactoryValid() returns false", async () => {
        vi.mocked(configMod.isTokenFactoryValid).mockReturnValue(false)

        const { useEcosystemCounts } = await import("./useEcosystemCounts")
        const { result } = renderHook(() => useEcosystemCounts(), { wrapper: makeWrapper() })
        await waitFor(() => expect(result.current.loading).toBe(false))
        expect(result.current.tokens).toBeNull()
        // listFactoryTokens should NOT have been called (no network request)
        expect(grc20Mod.listFactoryTokens).not.toHaveBeenCalled()
    })

    it("collections is null when isNftLaunchpadValid() returns false", async () => {
        vi.mocked(configMod.isNftLaunchpadValid).mockReturnValue(false)

        const { useEcosystemCounts } = await import("./useEcosystemCounts")
        const { result } = renderHook(() => useEcosystemCounts(), { wrapper: makeWrapper() })
        await waitFor(() => expect(result.current.loading).toBe(false))
        expect(result.current.collections).toBeNull()
        expect(launchpadMod.fetchCollectionList).not.toHaveBeenCalled()
    })

    it("agents is null when isRealmValid returns false for agent_registry", async () => {
        vi.mocked(configMod.isRealmValid).mockReturnValue(false)

        const { useEcosystemCounts } = await import("./useEcosystemCounts")
        const { result } = renderHook(() => useEcosystemCounts(), { wrapper: makeWrapper() })
        await waitFor(() => expect(result.current.loading).toBe(false))
        expect(result.current.agents).toBeNull()
        expect(agentMod.fetchAgents).not.toHaveBeenCalled()
    })

    it("gated sources are null while ungated sources (validators, daos) still resolve", async () => {
        vi.mocked(configMod.isTokenFactoryValid).mockReturnValue(false)
        vi.mocked(configMod.isNftLaunchpadValid).mockReturnValue(false)
        vi.mocked(configMod.isRealmValid).mockReturnValue(false)

        const { useEcosystemCounts } = await import("./useEcosystemCounts")
        const { result } = renderHook(() => useEcosystemCounts(), { wrapper: makeWrapper() })
        await waitFor(() => expect(result.current.loading).toBe(false))
        expect(result.current.tokens).toBeNull()
        expect(result.current.agents).toBeNull()
        expect(result.current.collections).toBeNull()
        // Ungated sources always run
        expect(result.current.validators).toBe(5)
        expect(result.current.daos).toBe(7)
    })
})
