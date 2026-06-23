/**
 * useFeaturedDao.test.ts
 *
 * Covers:
 * 1. configured + valid network (test13) with data → state:"ready", dao populated
 * 2. network with no configured/valid featured DAO → state:"empty", invitationHref set, dao undefined
 * 3. underlying source in error → state:"error"
 * 4. underlying source loading → state:"loading"
 * 5. snapshot path: snapshot usable with featuredDao → state:"ready", dao from snapshot
 * 6. snapshot usable but featuredDao empty → state:"empty"
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"
import React from "react"

// ── Module-level mocks ────────────────────────────────────────

vi.mock("../../lib/config", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../../lib/config")>()
    return {
        ...actual,
        getFeaturedDaoRealm: vi.fn((networkKey: string) => {
            if (networkKey === "test13") return "gno.land/r/samcrew/memba_dao"
            return null
        }),
    }
})

vi.mock("../../lib/dao", () => ({
    getDAOConfig: vi.fn(),
    getDAOProposals: vi.fn(),
}))

vi.mock("./useHomeSnapshot", () => ({
    useHomeSnapshot: vi.fn(() => ({
        snapshot: null,
        usable: false,
        isLoading: false,
    })),
}))

// ── Resolve mocked modules ────────────────────────────────────

const configMod = await import("../../lib/config")
const daoMod = await import("../../lib/dao")
const snapshotMod = await import("./useHomeSnapshot")

// ── Wrapper ───────────────────────────────────────────────────

function makeWrapper() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return function Wrapper({ children }: { children: ReactNode }) {
        return React.createElement(QueryClientProvider, { client }, children)
    }
}

// ── Shared fixtures ───────────────────────────────────────────

const MOCK_DAO_CONFIG = {
    name: "Memba DAO",
    description: "The Memba governance DAO",
    threshold: "60%",
    memberCount: 12,
    memberstorePath: "",
    tierDistribution: [],
    isArchived: false,
}

const MOCK_PROPOSALS = [
    {
        id: 42,
        title: "Expand contributor rewards program",
        description: "",
        category: "governance",
        status: "open" as const,
        author: "@samourai",
        authorProfile: "",
        tiers: [],
        yesPercent: 0,
        noPercent: 0,
        yesVotes: 0,
        noVotes: 0,
        abstainVotes: 0,
        totalVoters: 0,
        proposer: "@samourai",
    },
]

// ── Tests ─────────────────────────────────────────────────────

describe("useFeaturedDao — configured + valid network (test13), on-chain path", () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.mocked(configMod.getFeaturedDaoRealm).mockImplementation((nk) =>
            nk === "test13" ? "gno.land/r/samcrew/memba_dao" : null,
        )
        vi.mocked(snapshotMod.useHomeSnapshot).mockReturnValue({
            snapshot: null,
            usable: false,
            isLoading: false,
        })
        vi.mocked(daoMod.getDAOConfig).mockResolvedValue(MOCK_DAO_CONFIG)
        vi.mocked(daoMod.getDAOProposals).mockResolvedValue(MOCK_PROPOSALS)
    })

    it("returns state:'ready' and dao.name when data loads", async () => {
        const { useFeaturedDao } = await import("./useFeaturedDao")
        const { result } = renderHook(() => useFeaturedDao("test13"), { wrapper: makeWrapper() })

        await waitFor(() => expect(result.current.state).toBe("ready"))

        expect(result.current.dao).toBeDefined()
        expect(result.current.dao?.name).toBe("Memba DAO")
    })

    it("always sets invitationHref to /<network>/dao", async () => {
        const { useFeaturedDao } = await import("./useFeaturedDao")
        const { result } = renderHook(() => useFeaturedDao("test13"), { wrapper: makeWrapper() })

        await waitFor(() => expect(result.current.state).toBe("ready"))

        expect(result.current.invitationHref).toBe("/test13/dao")
    })

    it("sets dao.href to the in-app DAO page", async () => {
        const { useFeaturedDao } = await import("./useFeaturedDao")
        const { result } = renderHook(() => useFeaturedDao("test13"), { wrapper: makeWrapper() })

        await waitFor(() => expect(result.current.state).toBe("ready"))

        expect(result.current.dao?.href).toBe("/test13/dao/gno.land/r/samcrew/memba_dao")
    })

    it("dao.members reflects memberCount", async () => {
        const { useFeaturedDao } = await import("./useFeaturedDao")
        const { result } = renderHook(() => useFeaturedDao("test13"), { wrapper: makeWrapper() })

        await waitFor(() => expect(result.current.state).toBe("ready"))

        expect(result.current.dao?.members).toBe(12)
    })
})

describe("useFeaturedDao — network with no configured featured DAO", () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.mocked(configMod.getFeaturedDaoRealm).mockReturnValue(null)
        vi.mocked(snapshotMod.useHomeSnapshot).mockReturnValue({
            snapshot: null,
            usable: false,
            isLoading: false,
        })
    })

    it("returns state:'empty' immediately", async () => {
        const { useFeaturedDao } = await import("./useFeaturedDao")
        const { result } = renderHook(() => useFeaturedDao("gnoland1"), { wrapper: makeWrapper() })

        // No fetch is triggered — state resolves synchronously to "empty"
        await waitFor(() => expect(result.current.state).toBe("empty"))
    })

    it("leaves dao undefined", async () => {
        const { useFeaturedDao } = await import("./useFeaturedDao")
        const { result } = renderHook(() => useFeaturedDao("gnoland1"), { wrapper: makeWrapper() })

        await waitFor(() => expect(result.current.state).toBe("empty"))

        expect(result.current.dao).toBeUndefined()
    })

    it("sets invitationHref to /<network>/dao", async () => {
        const { useFeaturedDao } = await import("./useFeaturedDao")
        const { result } = renderHook(() => useFeaturedDao("gnoland1"), { wrapper: makeWrapper() })

        await waitFor(() => expect(result.current.state).toBe("empty"))

        expect(result.current.invitationHref).toBe("/gnoland1/dao")
    })
})

describe("useFeaturedDao — underlying source error", () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.mocked(configMod.getFeaturedDaoRealm).mockImplementation((nk) =>
            nk === "test13" ? "gno.land/r/samcrew/memba_dao" : null,
        )
        vi.mocked(snapshotMod.useHomeSnapshot).mockReturnValue({
            snapshot: null,
            usable: false,
            isLoading: false,
        })
        vi.mocked(daoMod.getDAOConfig).mockRejectedValue(new Error("RPC timeout"))
        vi.mocked(daoMod.getDAOProposals).mockRejectedValue(new Error("RPC timeout"))
    })

    it("returns state:'error' on fetch failure", async () => {
        const { useFeaturedDao } = await import("./useFeaturedDao")
        const { result } = renderHook(() => useFeaturedDao("test13"), { wrapper: makeWrapper() })

        await waitFor(() => expect(result.current.state).toBe("error"))
    })

    it("still sets invitationHref on error", async () => {
        const { useFeaturedDao } = await import("./useFeaturedDao")
        const { result } = renderHook(() => useFeaturedDao("test13"), { wrapper: makeWrapper() })

        await waitFor(() => expect(result.current.state).toBe("error"))

        expect(result.current.invitationHref).toBe("/test13/dao")
    })
})

describe("useFeaturedDao — loading state", () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.mocked(configMod.getFeaturedDaoRealm).mockImplementation((nk) =>
            nk === "test13" ? "gno.land/r/samcrew/memba_dao" : null,
        )
        vi.mocked(snapshotMod.useHomeSnapshot).mockReturnValue({
            snapshot: null,
            usable: false,
            isLoading: false,
        })
        // Never-resolving promise = perpetual loading
        vi.mocked(daoMod.getDAOConfig).mockReturnValue(new Promise(() => { /* never resolves */ }))
        vi.mocked(daoMod.getDAOProposals).mockReturnValue(new Promise(() => { /* never resolves */ }))
    })

    it("returns state:'loading' while fetch is in flight", async () => {
        const { useFeaturedDao } = await import("./useFeaturedDao")
        const { result } = renderHook(() => useFeaturedDao("test13"), { wrapper: makeWrapper() })

        expect(result.current.state).toBe("loading")
    })

    it("sets invitationHref even while loading", async () => {
        const { useFeaturedDao } = await import("./useFeaturedDao")
        const { result } = renderHook(() => useFeaturedDao("test13"), { wrapper: makeWrapper() })

        expect(result.current.invitationHref).toBe("/test13/dao")
    })
})

describe("useFeaturedDao — snapshot path (usable snapshot with featuredDao)", () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.mocked(configMod.getFeaturedDaoRealm).mockImplementation((nk) =>
            nk === "test13" ? "gno.land/r/samcrew/memba_dao" : null,
        )
        vi.mocked(snapshotMod.useHomeSnapshot).mockReturnValue({
            snapshot: {
                featuredDao: {
                    realmPath: "gno.land/r/samcrew/memba_dao",
                    name: "Snapshot DAO",
                    members: 7,
                    treasuryUgnot: BigInt(0),
                    openProposals: 3,
                    latestProposalTitle: "Snapshot proposal title",
                },
            } as Parameters<typeof snapshotMod.useHomeSnapshot>[never],
            usable: true,
            isLoading: false,
        })
    })

    it("returns state:'ready' from snapshot without calling getDAOConfig", async () => {
        const { useFeaturedDao } = await import("./useFeaturedDao")
        const { result } = renderHook(() => useFeaturedDao("test13"), { wrapper: makeWrapper() })

        await waitFor(() => expect(result.current.state).toBe("ready"))

        expect(daoMod.getDAOConfig).not.toHaveBeenCalled()
        expect(result.current.dao?.name).toBe("Snapshot DAO")
    })

    it("populates dao.members from snapshot", async () => {
        const { useFeaturedDao } = await import("./useFeaturedDao")
        const { result } = renderHook(() => useFeaturedDao("test13"), { wrapper: makeWrapper() })

        await waitFor(() => expect(result.current.state).toBe("ready"))

        expect(result.current.dao?.members).toBe(7)
    })
})

describe("useFeaturedDao — snapshot usable but featuredDao empty/missing", () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.mocked(configMod.getFeaturedDaoRealm).mockImplementation((nk) =>
            nk === "test13" ? "gno.land/r/samcrew/memba_dao" : null,
        )
    })

    it("returns state:'empty' when snapshot has no featuredDao field", async () => {
        vi.mocked(snapshotMod.useHomeSnapshot).mockReturnValue({
            snapshot: {} as Parameters<typeof snapshotMod.useHomeSnapshot>[never],
            usable: true,
            isLoading: false,
        })

        const { useFeaturedDao } = await import("./useFeaturedDao")
        const { result } = renderHook(() => useFeaturedDao("test13"), { wrapper: makeWrapper() })

        await waitFor(() => expect(result.current.state).toBe("empty"))
        expect(result.current.dao).toBeUndefined()
    })

    it("returns state:'empty' when snapshot featuredDao has blank realmPath", async () => {
        vi.mocked(snapshotMod.useHomeSnapshot).mockReturnValue({
            snapshot: {
                featuredDao: {
                    realmPath: "",
                    name: "",
                    members: 0,
                    treasuryUgnot: BigInt(0),
                    openProposals: 0,
                    latestProposalTitle: "",
                },
            } as Parameters<typeof snapshotMod.useHomeSnapshot>[never],
            usable: true,
            isLoading: false,
        })

        const { useFeaturedDao } = await import("./useFeaturedDao")
        const { result } = renderHook(() => useFeaturedDao("test13"), { wrapper: makeWrapper() })

        await waitFor(() => expect(result.current.state).toBe("empty"))
        expect(result.current.dao).toBeUndefined()
    })
})
