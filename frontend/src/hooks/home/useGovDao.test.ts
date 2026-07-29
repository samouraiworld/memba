/**
 * useGovDao.test.ts — TDD spec for the home GovDAO spotlight hook.
 *
 * GovDAO (gno.land/r/gov/dao) is the chain-level Layer-1 governance DAO. The
 * spotlight always renders (GovDAO always exists on-chain): on success it shows
 * the live open-proposal count + member count; metrics are omitted (honesty) when
 * 0/absent; a transient RPC error degrades to name + retry (state:"error").
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"
import React from "react"

vi.mock("../../lib/dao", () => ({
    getDAOConfig: vi.fn(),
    getDAOProposals: vi.fn(),
}))

vi.mock("../../lib/config", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../../lib/config")>()
    // isCalEnabled reads a build flag that is unset in tests; force it on so the
    // CAL branch is exercisable. The direct-path tests below mount no
    // ChainContext, so useChainOptional() still returns null for them.
    return { ...actual, NETWORKS: { test13: { rpcUrl: "https://rpc.test13.example" } }, isCalEnabled: () => true }
})

const daoMod = await import("../../lib/dao")

const CONFIG = { name: "GovDAO", description: "", threshold: "66%", memberCount: 61, memberstorePath: "", tierDistribution: [], isArchived: false }
const openProposal = (id: number) => ({ id, title: `P${id}`, description: "", category: "governance", status: "open" as const, author: "@a", authorProfile: "", tiers: [], yesPercent: 0, noPercent: 0, yesVotes: 0, noVotes: 0, abstainVotes: 0, totalVoters: 0, proposer: "@a" })

function makeWrapper() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return function Wrapper({ children }: { children: ReactNode }) {
        return React.createElement(QueryClientProvider, { client }, children)
    }
}

beforeEach(() => { vi.clearAllMocks() })

describe("useGovDao", () => {
    it("returns state:'ready' with open count, members, threshold, latest proposal, and a dao href", async () => {
        vi.mocked(daoMod.getDAOConfig).mockResolvedValue(CONFIG)
        // getDAOProposals returns newest-first (sorted by id desc); proposals[0] is the latest.
        vi.mocked(daoMod.getDAOProposals).mockResolvedValue([{ ...openProposal(4), status: "executed" as const }, openProposal(3), openProposal(2), openProposal(1)])
        const { useGovDao } = await import("./useGovDao")
        const { result } = renderHook(() => useGovDao("test13"), { wrapper: makeWrapper() })
        await waitFor(() => expect(result.current.state).toBe("ready"))
        expect(result.current.name).toBe("GovDAO")
        expect(result.current.openCount).toBe(3)
        expect(result.current.members).toBe(61)
        expect(result.current.threshold).toBe("66%")
        expect(result.current.latestProposal).toEqual({ title: "P4", status: "executed" })
        expect(result.current.href).toBe("/test13/dao/gno.land/r/gov/dao")
    })

    it("exposes up to 4 latest proposals (newest-first) with per-proposal hrefs, honest about vote%/author/date", async () => {
        vi.mocked(daoMod.getDAOConfig).mockResolvedValue(CONFIG)
        const props = [
            { ...openProposal(10), title: "Ten", status: "passed" as const, author: "@alice", yesPercent: 80, noPercent: 20, createdAt: "2026-06-20T00:00:00Z" },
            { ...openProposal(9), title: "Nine", author: "" }, // no author, 0 vote%, no date
            openProposal(8), openProposal(7), openProposal(6), // 5 total → only 4 surfaced
        ]
        vi.mocked(daoMod.getDAOProposals).mockResolvedValue(props)
        const { useGovDao } = await import("./useGovDao")
        const { result } = renderHook(() => useGovDao("test13"), { wrapper: makeWrapper() })
        await waitFor(() => expect(result.current.state).toBe("ready"))
        const lp = result.current.latestProposals!
        expect(lp).toHaveLength(4)
        expect(lp[0]).toMatchObject({
            id: 10, title: "Ten", status: "passed", author: "@alice",
            yesPercent: 80, noPercent: 20, createdAt: "2026-06-20T00:00:00Z",
            href: "/test13/dao/gno.land/r/gov/dao/proposal/10",
        })
        // honesty: empty author, 0 vote%, and absent date are omitted (undefined)
        expect(lp[1].author).toBeUndefined()
        expect(lp[1].yesPercent).toBeUndefined()
        expect(lp[1].createdAt).toBeUndefined()
        expect(lp[1].href).toBe("/test13/dao/gno.land/r/gov/dao/proposal/9")
    })

    it("returns an empty latestProposals array (not undefined) when there are none", async () => {
        vi.mocked(daoMod.getDAOConfig).mockResolvedValue(CONFIG)
        vi.mocked(daoMod.getDAOProposals).mockResolvedValue([])
        const { useGovDao } = await import("./useGovDao")
        const { result } = renderHook(() => useGovDao("test13"), { wrapper: makeWrapper() })
        await waitFor(() => expect(result.current.state).toBe("ready"))
        expect(result.current.latestProposals).toEqual([])
    })

    it("picks the most recent proposal by id (newest-first list)", async () => {
        vi.mocked(daoMod.getDAOConfig).mockResolvedValue(CONFIG)
        vi.mocked(daoMod.getDAOProposals).mockResolvedValue([openProposal(9), openProposal(2)])
        const { useGovDao } = await import("./useGovDao")
        const { result } = renderHook(() => useGovDao("test13"), { wrapper: makeWrapper() })
        await waitFor(() => expect(result.current.state).toBe("ready"))
        expect(result.current.latestProposal).toEqual({ title: "P9", status: "open" })
    })

    it("omits metrics (undefined, not 0) when there are no proposals / 0 members / no threshold", async () => {
        vi.mocked(daoMod.getDAOConfig).mockResolvedValue({ ...CONFIG, memberCount: 0, threshold: "" })
        vi.mocked(daoMod.getDAOProposals).mockResolvedValue([])
        const { useGovDao } = await import("./useGovDao")
        const { result } = renderHook(() => useGovDao("test13"), { wrapper: makeWrapper() })
        await waitFor(() => expect(result.current.state).toBe("ready"))
        expect(result.current.openCount).toBeUndefined()
        expect(result.current.members).toBeUndefined()
        expect(result.current.threshold).toBeUndefined()
        expect(result.current.latestProposal).toBeUndefined()
        expect(result.current.name).toBe("GovDAO")
    })

    it("degrades to state:'error' with the GovDAO name + href on RPC failure", async () => {
        vi.mocked(daoMod.getDAOConfig).mockRejectedValue(new Error("RPC down"))
        vi.mocked(daoMod.getDAOProposals).mockRejectedValue(new Error("RPC down"))
        const { useGovDao } = await import("./useGovDao")
        const { result } = renderHook(() => useGovDao("test13"), { wrapper: makeWrapper() })
        await waitFor(() => expect(result.current.state).toBe("error"))
        expect(result.current.name).toBe("GovDAO")
        expect(result.current.href).toBe("/test13/dao/gno.land/r/gov/dao")
        expect(typeof result.current.refetch).toBe("function")
    })
})

describe("useGovDao — CAL path (B-5 Phase 3 wave 1)", () => {
    /** Mounts the hook with a fake CAL provider injected via ChainContext. */
    async function renderWithCal(provider: unknown) {
        const { ChainContext } = await import("../../lib/chain/context")
        const { useGovDao } = await import("./useGovDao")
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
        const wrapper = ({ children }: { children: ReactNode }) =>
            React.createElement(QueryClientProvider, { client },
                React.createElement(ChainContext.Provider, {
                    value: {
                        provider,
                        family: "gno",
                        network: { chainId: "topaz-1", family: "gno", name: "Topaz" },
                        switchChain: vi.fn(),
                        availableNetworks: [],
                        isLoading: false,
                    } as never,
                }, children))
        return renderHook(() => useGovDao("topaz"), { wrapper })
    }

    it("reads through the provider and relays the chain's own percentages", async () => {
        const provider = {
            family: "gno",
            getDAOConfig: vi.fn().mockResolvedValue({
                name: "GovDAO", description: "", threshold: 6600,
                thresholdLabel: "66%", quorum: 0, memberCount: 61,
            }),
            getDAOProposals: vi.fn().mockResolvedValue([{
                id: 9, title: "P9", description: "", category: "governance", status: "open",
                proposer: { address: "g1a", family: "gno" },
                yesVotes: 1, noVotes: 1, abstainVotes: 0, totalVoters: 2,
                author: "@alice", yesPercent: 90, noPercent: 10,
            }]),
        }
        const { result } = await renderWithCal(provider)
        await waitFor(() => expect(result.current.state).toBe("ready"))

        // the direct-lib readers must NOT have been used
        expect(vi.mocked(daoMod.getDAOConfig)).not.toHaveBeenCalled()
        expect(vi.mocked(daoMod.getDAOProposals)).not.toHaveBeenCalled()

        expect(result.current.members).toBe(61)
        expect(result.current.threshold).toBe("66%")   // the realm's wording, not "6600"
        const row = result.current.latestProposals?.[0]
        expect(row?.yesPercent).toBe(90)               // relayed, not 50 from the counts
        expect(row?.noPercent).toBe(10)
        expect(row?.author).toBe("@alice")
    })

    it("omits the vote figures entirely when the provider flags them unavailable", async () => {
        const provider = {
            family: "gno",
            getDAOConfig: vi.fn().mockResolvedValue({
                name: "GovDAO", description: "", threshold: null,
                thresholdLabel: undefined, quorum: 0, memberCount: 3,
            }),
            getDAOProposals: vi.fn().mockResolvedValue([{
                id: 1, title: "P1", description: "", category: "", status: "open",
                proposer: { address: "g1a", family: "gno" },
                yesVotes: 0, noVotes: 0, abstainVotes: 0, totalVoters: 0,
                yesPercent: 0, noPercent: 0, votesUnavailable: true,
            }]),
        }
        const { result } = await renderWithCal(provider)
        await waitFor(() => expect(result.current.state).toBe("ready"))

        const row = result.current.latestProposals?.[0]
        expect(row?.yesPercent).toBeUndefined()
        expect(row?.noPercent).toBeUndefined()
        expect(result.current.threshold).toBeUndefined()  // no label → omitted, not "null"
    })
})
