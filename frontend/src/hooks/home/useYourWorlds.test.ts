/**
 * useYourWorlds.test.ts
 *
 * TDD spec for the "your worlds" hook.
 *
 * Covers:
 * 1. saved worlds with data → state:"ready", world objects with name/href
 * 2. a world reporting 0 members → openCount undefined (honesty guard)
 * 3. no saved worlds → state:"empty", worlds: []
 * 4. per-DAO source erroring for ONE world doesn't crash the board (degrades that card)
 * 5. loading → state:"loading"
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"
import React from "react"

// ── Module-level mocks ────────────────────────────────────────

vi.mock("../../lib/daoSlug", () => ({
    getSavedDAOsForOrg: vi.fn(() => []),
}))

vi.mock("../../lib/dao", () => ({
    getDAOConfig: vi.fn(),
    getDAOProposals: vi.fn(),
}))

vi.mock("../../lib/config", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../../lib/config")>()
    return {
        ...actual,
        NETWORKS: {
            test13: { rpcUrl: "https://rpc.test13.example" },
        },
        DEFAULT_NETWORK: "test13",
    }
})

// Mock useNetworkKey — hook depends on URL params; we stub it
vi.mock("../../hooks/useNetworkNav", () => ({
    useNetworkKey: vi.fn(() => "test13"),
}))

// ── Resolve mocked modules ────────────────────────────────────

const daoSlugMod = await import("../../lib/daoSlug")
const daoMod = await import("../../lib/dao")

// ── Shared fixtures ───────────────────────────────────────────

const SAVED_DAOS = [
    { realmPath: "gno.land/r/gov/dao", name: "GovDAO", addedAt: 1000 },
    { realmPath: "gno.land/r/test/myorg", name: "MyOrg DAO", addedAt: 2000 },
]

const MOCK_DAO_CONFIG = {
    name: "GovDAO",
    description: "",
    threshold: "60%",
    memberCount: 5,
    memberstorePath: "",
    tierDistribution: [],
    isArchived: false,
}

const MOCK_PROPOSALS = [
    {
        id: 1,
        title: "Proposal A",
        description: "",
        category: "governance",
        status: "open" as const,
        author: "@user",
        authorProfile: "",
        tiers: [],
        yesPercent: 0,
        noPercent: 0,
        yesVotes: 0,
        noVotes: 0,
        abstainVotes: 0,
        totalVoters: 0,
        proposer: "@user",
    },
]

// ── Wrapper ───────────────────────────────────────────────────

function makeWrapper() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return function Wrapper({ children }: { children: ReactNode }) {
        return React.createElement(QueryClientProvider, { client }, children)
    }
}

// ── Tests ─────────────────────────────────────────────────────

describe("useYourWorlds — saved worlds with data", () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.mocked(daoSlugMod.getSavedDAOsForOrg).mockReturnValue(SAVED_DAOS)
        // Each world gets its own distinct config so names match the saved names
        vi.mocked(daoMod.getDAOConfig)
            .mockResolvedValueOnce(MOCK_DAO_CONFIG)                             // GovDAO
            .mockResolvedValueOnce({ ...MOCK_DAO_CONFIG, name: "MyOrg DAO" })  // MyOrg DAO
        vi.mocked(daoMod.getDAOProposals).mockResolvedValue(MOCK_PROPOSALS)
    })

    it("returns state:'ready' when ≥1 world resolves", async () => {
        const { useYourWorlds } = await import("./useYourWorlds")
        const { result } = renderHook(() => useYourWorlds("test13", null), { wrapper: makeWrapper() })

        await waitFor(() => expect(result.current.state).toBe("ready"))
    })

    it("returns world objects with name and href", async () => {
        const { useYourWorlds } = await import("./useYourWorlds")
        const { result } = renderHook(() => useYourWorlds("test13", null), { wrapper: makeWrapper() })

        await waitFor(() => expect(result.current.state).toBe("ready"))

        const worlds = result.current.worlds
        expect(worlds.length).toBe(2)
        expect(worlds[0].name).toBe("GovDAO")
        expect(worlds[0].href).toBe("/test13/dao/gno.land/r/gov/dao")
        expect(worlds[1].name).toBe("MyOrg DAO")
        expect(worlds[1].href).toBe("/test13/dao/gno.land/r/test/myorg")
    })

    it("exposes openCount when proposals exist", async () => {
        const { useYourWorlds } = await import("./useYourWorlds")
        const { result } = renderHook(() => useYourWorlds("test13", null), { wrapper: makeWrapper() })

        await waitFor(() => expect(result.current.state).toBe("ready"))

        // MOCK_PROPOSALS has 1 open proposal
        expect(result.current.worlds[0].openCount).toBe(1)
    })
})

describe("useYourWorlds — honesty guard: 0-count metrics omitted", () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.mocked(daoSlugMod.getSavedDAOsForOrg).mockReturnValue([
            { realmPath: "gno.land/r/gov/dao", name: "GovDAO", addedAt: 1000 },
        ])
        vi.mocked(daoMod.getDAOConfig).mockResolvedValue({
            ...MOCK_DAO_CONFIG,
            memberCount: 0,
        })
        // No open proposals → openCount would be 0
        vi.mocked(daoMod.getDAOProposals).mockResolvedValue([])
    })

    it("omits openCount (undefined, not 0) when no open proposals", async () => {
        const { useYourWorlds } = await import("./useYourWorlds")
        const { result } = renderHook(() => useYourWorlds("test13", null), { wrapper: makeWrapper() })

        await waitFor(() => expect(result.current.state).toBe("ready"))

        expect(result.current.worlds[0].openCount).toBeUndefined()
    })
})

describe("useYourWorlds — no saved worlds", () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.mocked(daoSlugMod.getSavedDAOsForOrg).mockReturnValue([])
    })

    it("returns state:'empty' with empty worlds array", async () => {
        const { useYourWorlds } = await import("./useYourWorlds")
        const { result } = renderHook(() => useYourWorlds("test13", null), { wrapper: makeWrapper() })

        // No fetch needed — resolves synchronously
        await waitFor(() => expect(result.current.state).toBe("empty"))
        expect(result.current.worlds).toHaveLength(0)
    })
})

describe("useYourWorlds — per-world source error degrades card, not board", () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.mocked(daoSlugMod.getSavedDAOsForOrg).mockReturnValue(SAVED_DAOS)
        // First world errors, second world succeeds
        vi.mocked(daoMod.getDAOConfig)
            .mockRejectedValueOnce(new Error("RPC timeout"))
            .mockResolvedValueOnce(MOCK_DAO_CONFIG)
        vi.mocked(daoMod.getDAOProposals)
            .mockRejectedValueOnce(new Error("RPC timeout"))
            .mockResolvedValueOnce(MOCK_PROPOSALS)
    })

    it("board state remains 'ready' (not 'error') when only one world fails", async () => {
        const { useYourWorlds } = await import("./useYourWorlds")
        const { result } = renderHook(() => useYourWorlds("test13", null), { wrapper: makeWrapper() })

        await waitFor(() => expect(result.current.state).toBe("ready"))
    })

    it("the failing world still appears in worlds array with error degradation", async () => {
        const { useYourWorlds } = await import("./useYourWorlds")
        const { result } = renderHook(() => useYourWorlds("test13", null), { wrapper: makeWrapper() })

        await waitFor(() => expect(result.current.state).toBe("ready"))

        // Both worlds still in list (degraded, not removed)
        expect(result.current.worlds).toHaveLength(2)
    })

    it("the failed world has its base name and href from localStorage", async () => {
        const { useYourWorlds } = await import("./useYourWorlds")
        const { result } = renderHook(() => useYourWorlds("test13", null), { wrapper: makeWrapper() })

        await waitFor(() => expect(result.current.state).toBe("ready"))

        // First world failed — name/href come from saved DAO (not from RPC config)
        expect(result.current.worlds[0].name).toBe("GovDAO")
        expect(result.current.worlds[0].href).toBe("/test13/dao/gno.land/r/gov/dao")
    })
})

describe("useYourWorlds — loading state", () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.mocked(daoSlugMod.getSavedDAOsForOrg).mockReturnValue(SAVED_DAOS)
        // Never-resolving promises = perpetual loading
        vi.mocked(daoMod.getDAOConfig).mockReturnValue(new Promise(() => { /* never */ }))
        vi.mocked(daoMod.getDAOProposals).mockReturnValue(new Promise(() => { /* never */ }))
    })

    it("returns state:'loading' while fetches are in flight", async () => {
        const { useYourWorlds } = await import("./useYourWorlds")
        const { result } = renderHook(() => useYourWorlds("test13", null), { wrapper: makeWrapper() })

        expect(result.current.state).toBe("loading")
    })
})

describe("useYourWorlds — refetch is always exposed", () => {
    it("exposes a refetch function when state is empty (no saved DAOs)", async () => {
        vi.clearAllMocks()
        vi.mocked(daoSlugMod.getSavedDAOsForOrg).mockReturnValue([])
        const { useYourWorlds } = await import("./useYourWorlds")
        const { result } = renderHook(() => useYourWorlds("test13", null), { wrapper: makeWrapper() })

        await waitFor(() => expect(result.current.state).toBe("empty"))
        expect(typeof result.current.refetch).toBe("function")
    })

    it("exposes a refetch function when state is ready", async () => {
        vi.clearAllMocks()
        vi.mocked(daoSlugMod.getSavedDAOsForOrg).mockReturnValue(SAVED_DAOS)
        vi.mocked(daoMod.getDAOConfig).mockResolvedValue(MOCK_DAO_CONFIG)
        vi.mocked(daoMod.getDAOProposals).mockResolvedValue(MOCK_PROPOSALS)
        const { useYourWorlds } = await import("./useYourWorlds")
        const { result } = renderHook(() => useYourWorlds("test13", null), { wrapper: makeWrapper() })

        await waitFor(() => expect(result.current.state).toBe("ready"))
        expect(typeof result.current.refetch).toBe("function")
    })
})
