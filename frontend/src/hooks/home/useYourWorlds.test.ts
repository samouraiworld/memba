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
    getMemberRole: vi.fn(),
    deriveRoleLabel: vi.fn(),
}))

// useAuth reads localStorage directly; stub it. Default = disconnected, so the
// role query stays disabled (role undefined) for the pre-existing specs.
vi.mock("../useAuth", () => ({
    useAuth: vi.fn(() => ({ isAuthenticated: false, address: "", token: null, loading: false, error: null })),
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
const authMod = await import("../useAuth")

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

// mockReturnValue/mockResolvedValue survive vi.clearAllMocks(), so reset the
// auth + role mocks to safe defaults before every test (a test that needs a
// connected wallet / a role opts in explicitly).
beforeEach(() => {
    vi.mocked(authMod.useAuth).mockReturnValue({
        isAuthenticated: false, address: "", token: null, loading: false, error: null,
    } as unknown as ReturnType<typeof authMod.useAuth>)
    vi.mocked(daoMod.getMemberRole).mockResolvedValue(null)
    vi.mocked(daoMod.deriveRoleLabel).mockReturnValue(undefined)
})

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

describe("useYourWorlds — members enrichment", () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.mocked(daoSlugMod.getSavedDAOsForOrg).mockReturnValue([
            { realmPath: "gno.land/r/gov/dao", name: "GovDAO", addedAt: 1000 },
        ])
        vi.mocked(daoMod.getDAOProposals).mockResolvedValue([])
    })

    it("populates members from getDAOConfig.memberCount", async () => {
        vi.mocked(daoMod.getDAOConfig).mockResolvedValue({ ...MOCK_DAO_CONFIG, memberCount: 128 })
        const { useYourWorlds } = await import("./useYourWorlds")
        const { result } = renderHook(() => useYourWorlds("test13", null), { wrapper: makeWrapper() })

        await waitFor(() => expect(result.current.state).toBe("ready"))
        expect(result.current.worlds[0].members).toBe(128)
    })

    it("omits members (undefined, not 0) when the DAO reports 0 members", async () => {
        vi.mocked(daoMod.getDAOConfig).mockResolvedValue({ ...MOCK_DAO_CONFIG, memberCount: 0 })
        const { useYourWorlds } = await import("./useYourWorlds")
        const { result } = renderHook(() => useYourWorlds("test13", null), { wrapper: makeWrapper() })

        await waitFor(() => expect(result.current.state).toBe("ready"))
        expect(result.current.worlds[0].members).toBeUndefined()
    })
})

describe("useYourWorlds — role badge (connected wallet only)", () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.mocked(daoSlugMod.getSavedDAOsForOrg).mockReturnValue([
            { realmPath: "gno.land/r/gov/dao", name: "GovDAO", addedAt: 1000 },
        ])
        vi.mocked(daoMod.getDAOConfig).mockResolvedValue(MOCK_DAO_CONFIG)
        vi.mocked(daoMod.getDAOProposals).mockResolvedValue([])
    })

    it("populates role from getMemberRole + deriveRoleLabel when connected", async () => {
        vi.mocked(authMod.useAuth).mockReturnValue({
            isAuthenticated: true, address: "g1me", token: null, loading: false, error: null,
        } as unknown as ReturnType<typeof authMod.useAuth>)
        vi.mocked(daoMod.getMemberRole).mockResolvedValue({
            address: "g1me", roles: ["admin"], tier: "", votingPower: 0, username: "",
        })
        vi.mocked(daoMod.deriveRoleLabel).mockReturnValue("admin")

        const { useYourWorlds } = await import("./useYourWorlds")
        const { result } = renderHook(() => useYourWorlds("test13", null), { wrapper: makeWrapper() })

        await waitFor(() => expect(result.current.worlds[0]?.role).toBe("admin"))
    })

    it("omits role and skips the lookup when the wallet is disconnected", async () => {
        // default useAuth mock = disconnected
        const { useYourWorlds } = await import("./useYourWorlds")
        const { result } = renderHook(() => useYourWorlds("test13", null), { wrapper: makeWrapper() })

        await waitFor(() => expect(result.current.state).toBe("ready"))
        expect(result.current.worlds[0].role).toBeUndefined()
        expect(daoMod.getMemberRole).not.toHaveBeenCalled()
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

describe("useYourWorlds — network scoping (MH2)", () => {
    // Legacy untagged entries: shown only if the realm resolves on the active
    // network. One that fails to resolve is treated as saved-on-another-network
    // (e.g. retired test11) and dropped — NOT rendered as a dead degraded card.
    describe("legacy untagged: unreachable here is dropped, not degraded", () => {
        beforeEach(() => {
            vi.clearAllMocks()
            vi.mocked(daoSlugMod.getSavedDAOsForOrg).mockReturnValue(SAVED_DAOS)
            // First (GovDAO) fails to resolve here; second (MyOrg) succeeds.
            vi.mocked(daoMod.getDAOConfig)
                .mockRejectedValueOnce(new Error("RPC timeout"))
                .mockResolvedValueOnce({ ...MOCK_DAO_CONFIG, name: "MyOrg DAO" })
            vi.mocked(daoMod.getDAOProposals)
                .mockRejectedValueOnce(new Error("RPC timeout"))
                .mockResolvedValueOnce(MOCK_PROPOSALS)
        })

        it("board state stays 'ready' when one world fails to resolve", async () => {
            const { useYourWorlds } = await import("./useYourWorlds")
            const { result } = renderHook(() => useYourWorlds("test13", null), { wrapper: makeWrapper() })
            await waitFor(() => expect(result.current.state).toBe("ready"))
        })

        it("drops the unreachable untagged world (only the resolving one remains)", async () => {
            const { useYourWorlds } = await import("./useYourWorlds")
            const { result } = renderHook(() => useYourWorlds("test13", null), { wrapper: makeWrapper() })
            await waitFor(() => expect(result.current.state).toBe("ready"))
            await waitFor(() => expect(result.current.worlds).toHaveLength(1))
            expect(result.current.worlds[0].name).toBe("MyOrg DAO")
            expect(result.current.worlds[0].href).toBe("/test13/dao/gno.land/r/test/myorg")
        })
    })

    // Entries tagged for the active network are known to live here, so a transient
    // RPC error keeps them as a degraded card (graceful — unlike untagged ones).
    describe("tagged for the active network: degrade gracefully on RPC error", () => {
        beforeEach(() => {
            vi.clearAllMocks()
            vi.mocked(daoSlugMod.getSavedDAOsForOrg).mockReturnValue([
                { realmPath: "gno.land/r/gov/dao", name: "GovDAO", addedAt: 1000, network: "test13" },
            ])
            vi.mocked(daoMod.getDAOConfig).mockRejectedValue(new Error("RPC timeout"))
            vi.mocked(daoMod.getDAOProposals).mockRejectedValue(new Error("RPC timeout"))
        })

        it("keeps a tagged-for-this-network DAO as a degraded card", async () => {
            const { useYourWorlds } = await import("./useYourWorlds")
            const { result } = renderHook(() => useYourWorlds("test13", null), { wrapper: makeWrapper() })
            await waitFor(() => expect(result.current.state).toBe("ready"))
            await waitFor(() => expect(result.current.worlds).toHaveLength(1))
            expect(result.current.worlds[0].name).toBe("GovDAO")
            expect(result.current.worlds[0].degraded).toBe(true)
        })
    })

    // Entries tagged for a different network are excluded even if they would resolve.
    describe("tagged for a different network: excluded", () => {
        beforeEach(() => {
            vi.clearAllMocks()
            vi.mocked(daoSlugMod.getSavedDAOsForOrg).mockReturnValue([
                { realmPath: "gno.land/r/gov/dao", name: "GovDAO", addedAt: 1000, network: "gnoland1" },
            ])
            vi.mocked(daoMod.getDAOConfig).mockResolvedValue(MOCK_DAO_CONFIG)
            vi.mocked(daoMod.getDAOProposals).mockResolvedValue([])
        })

        it("excludes a DAO tagged for another network", async () => {
            const { useYourWorlds } = await import("./useYourWorlds")
            const { result } = renderHook(() => useYourWorlds("test13", null), { wrapper: makeWrapper() })
            await waitFor(() => expect(result.current.state).toBe("ready"))
            expect(result.current.worlds).toHaveLength(0)
        })
    })
})

describe("useYourWorlds — network scoping (MH2): untagged that renders nothing here is dropped", () => {
    // The real stale-DAO leak (E-F9): getDAOConfig resolves to null (the realm
    // does not render on the active network) WITHOUT throwing, so the queryFn fell
    // back to the saved name and rendered a dead card. An untagged entry that does
    // not actually resolve here must be dropped — it was saved on another testnet
    // (e.g. retired test11/test12), not deployed on test13.
    beforeEach(() => {
        vi.clearAllMocks()
        vi.mocked(daoSlugMod.getSavedDAOsForOrg).mockReturnValue([
            { realmPath: "gno.land/r/test/retired", name: "Retired DAO", addedAt: 1000 },
        ])
        vi.mocked(daoMod.getDAOConfig).mockResolvedValue(null)
        vi.mocked(daoMod.getDAOProposals).mockResolvedValue([])
    })

    it("drops an untagged DAO whose realm returns no render on the active network", async () => {
        const { useYourWorlds } = await import("./useYourWorlds")
        const { result } = renderHook(() => useYourWorlds("test13", null), { wrapper: makeWrapper() })
        await waitFor(() => expect(result.current.state).toBe("ready"))
        expect(result.current.worlds).toHaveLength(0)
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
