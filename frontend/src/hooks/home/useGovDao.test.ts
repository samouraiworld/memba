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
    return { ...actual, NETWORKS: { test13: { rpcUrl: "https://rpc.test13.example" } } }
})

const daoMod = await import("../../lib/dao")

const CONFIG = { name: "GovDAO", description: "", threshold: "", memberCount: 61, memberstorePath: "", tierDistribution: [], isArchived: false }
const openProposal = (id: number) => ({ id, title: `P${id}`, description: "", category: "governance", status: "open" as const, author: "@a", authorProfile: "", tiers: [], yesPercent: 0, noPercent: 0, yesVotes: 0, noVotes: 0, abstainVotes: 0, totalVoters: 0, proposer: "@a" })

function makeWrapper() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return function Wrapper({ children }: { children: ReactNode }) {
        return React.createElement(QueryClientProvider, { client }, children)
    }
}

beforeEach(() => { vi.clearAllMocks() })

describe("useGovDao", () => {
    it("returns state:'ready' with open count, members, and a dao href", async () => {
        vi.mocked(daoMod.getDAOConfig).mockResolvedValue(CONFIG)
        vi.mocked(daoMod.getDAOProposals).mockResolvedValue([openProposal(1), openProposal(2), openProposal(3), { ...openProposal(4), status: "executed" as const }])
        const { useGovDao } = await import("./useGovDao")
        const { result } = renderHook(() => useGovDao("test13"), { wrapper: makeWrapper() })
        await waitFor(() => expect(result.current.state).toBe("ready"))
        expect(result.current.name).toBe("GovDAO")
        expect(result.current.openCount).toBe(3)
        expect(result.current.members).toBe(61)
        expect(result.current.href).toBe("/test13/dao/gno.land/r/gov/dao")
    })

    it("omits metrics (undefined, not 0) when there are no open proposals / 0 members", async () => {
        vi.mocked(daoMod.getDAOConfig).mockResolvedValue({ ...CONFIG, memberCount: 0 })
        vi.mocked(daoMod.getDAOProposals).mockResolvedValue([])
        const { useGovDao } = await import("./useGovDao")
        const { result } = renderHook(() => useGovDao("test13"), { wrapper: makeWrapper() })
        await waitFor(() => expect(result.current.state).toBe("ready"))
        expect(result.current.openCount).toBeUndefined()
        expect(result.current.members).toBeUndefined()
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
