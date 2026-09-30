import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const reads = vi.hoisted(() => ({ full: { name: "Full DAO", tierDistribution: [{ tier: "Members", count: 1 }] } }))
vi.mock("../../lib/dao", async (original) => ({
    ...(await original<typeof import("../../lib/dao")>()),
    getDAOConfig: vi.fn(async () => reads.full),
    getProposalDetail: vi.fn(async () => ({ id: 3, title: "A proposal", description: "", status: "open", author: "g1author", proposer: "", yesVotes: 1, noVotes: 0, abstainVotes: 0 })),
    getProposalVotes: vi.fn(async () => []),
}))
vi.mock("../../hooks/useDaoKind", () => ({ useDaoKind: vi.fn() }))
vi.mock("../../lib/dao/membaV2Shell", async (original) => ({
    ...(await original<typeof import("../../lib/dao/membaV2Shell")>()),
    hasVotedOnV2: vi.fn(),
    findV2VoterChoice: vi.fn(),
}))

import { getDAOConfig, getProposalDetail } from "../../lib/dao"
import { findV2VoterChoice, hasVotedOnV2 } from "../../lib/dao/membaV2Shell"
import { useDaoKind } from "../../hooks/useDaoKind"
import { useDaoConfig, useMyVote, useProposal } from "./useOsDao"

const provider = () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

beforeEach(() => { vi.clearAllMocks() })

describe("OS DAO config cache", () => {
    it("does not reuse a light classic-page config as the full OS config", async () => {
        const realm = "gno.land/r/alice/team"
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
        client.setQueryData(["dao", "config", realm], { name: "Light DAO" })
        const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
        const { result } = renderHook(() => useDaoConfig(realm), { wrapper })

        await waitFor(() => expect(result.current.isSuccess).toBe(true))
        expect(result.current.data).toEqual(reads.full)
        expect(getDAOConfig).toHaveBeenCalledWith(expect.any(String), realm, true)
        expect(client.getQueryData(["dao", "config", realm])).toEqual({ name: "Light DAO" })
    })
})

describe("OS DAO loaders and the contract kind", () => {
    it("reads no config while the caller has not enabled it", async () => {
        const { result } = renderHook(() => useDaoConfig("gno.land/r/samcrew/memba_dao", false), { wrapper: provider() })
        await new Promise((resolve) => setTimeout(resolve, 20))
        expect(result.current.fetchStatus).toBe("idle")
        expect(result.current.data).toBeUndefined()
        expect(getDAOConfig).not.toHaveBeenCalled()
    })

    it("never reads a weighted DAO's proposal through the other kinds' loaders", async () => {
        vi.mocked(useDaoKind).mockReturnValue({ kind: "weighted", loading: false, error: null, capabilities: { propose: [] } } as unknown as ReturnType<typeof useDaoKind>)
        const { result } = renderHook(() => useProposal("gno.land/r/samcrew/memba_dao", 3), { wrapper: provider() })
        await new Promise((resolve) => setTimeout(resolve, 20))
        expect(result.current.fetchStatus).toBe("idle")
        expect(getProposalDetail).not.toHaveBeenCalled()
    })

    it("reads a proposal of the other kinds once the contract is known", async () => {
        vi.mocked(useDaoKind).mockReturnValue({ kind: "memba-v1", loading: false, error: null, capabilities: { propose: [] } } as unknown as ReturnType<typeof useDaoKind>)
        const { result } = renderHook(() => useProposal("gno.land/r/alice/team", 3), { wrapper: provider() })
        await waitFor(() => expect(result.current.isSuccess).toBe(true))
        expect(getProposalDetail).toHaveBeenCalledWith(expect.any(String), "gno.land/r/alice/team", 3)
    })
})

describe("OS DAO member vote", () => {
    it("keeps the vote recorded with unknown choice when vote pages are unavailable", async () => {
        vi.mocked(hasVotedOnV2).mockResolvedValue(true)
        vi.mocked(findV2VoterChoice).mockRejectedValue(new Error("RPC unavailable"))
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
        const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
        const { result } = renderHook(() => useMyVote("gno.land/r/alice/team", 7, "g1member", true), { wrapper })

        await waitFor(() => expect(result.current.isSuccess).toBe(true))
        expect(result.current.data).toEqual({ voted: true, choice: null })
    })
})
