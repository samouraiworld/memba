import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import type { DaoKind } from "../../lib/dao/kind"

const MEMBER = "g1manfred47kzduec920z88wfr64ylksmdcedlf5"
const state = vi.hoisted(() => ({ kind: "govdao" as DaoKind, members: [] as string[] }))

vi.mock("react-router-dom", async (orig) => ({
    ...(await orig<typeof import("react-router-dom")>()),
    useOutletContext: () => ({ auth: { isAuthenticated: true, token: null }, adena: { address: "g1manfred47kzduec920z88wfr64ylksmdcedlf5" } }),
}))
vi.mock("../../hooks/useDaoKind", async () => {
    const { capabilitiesFor } = await import("../../lib/dao/kind")
    const { NETWORKS } = await import("../../lib/config")
    const { useNetworkKey } = await import("../../hooks/useNetworkNav")
    return {
        useDaoKind: () => {
            const network = NETWORKS[useNetworkKey()]
            return { kind: state.kind, capabilities: capabilitiesFor(state.kind, network), loading: false, error: null }
        },
    }
})
vi.mock("../../contexts/JitsiContext", () => ({ useJitsiContext: () => ({ session: null, joinRoom: vi.fn() }) }))
vi.mock("../../lib/quests", () => ({ completeQuest: vi.fn(), trackPageVisit: vi.fn() }))
vi.mock("../../lib/profile", () => ({ resolveOnChainUsername: async () => "" }))
vi.mock("./DAOAIInsight", () => ({ DAOAIInsight: () => null }))
vi.mock("../../pages/CreateDAO", () => ({ CreateDAO: () => <div>Create DAO form</div> }))
vi.mock("../../pages/ChannelsPage", () => ({ ChannelsPage: () => <div>Channels page</div> }))
vi.mock("../../pages/ProposeDAO", () => ({ ProposeDAO: () => <div>Propose form</div> }))
vi.mock("../../lib/dao", async (orig) => ({
    ...(await orig<typeof import("../../lib/dao")>()),
    getDAOConfig: async () => ({ name: "Some DAO", description: "", threshold: "60%", memberCount: 1, memberstorePath: "", tierDistribution: [], isArchived: false }),
    getDAOMembers: async () => state.members.map((address) => ({ address, roles: [], tier: "", votingPower: 1, username: "" })),
    getDAOProposals: async () => [],
    getProposalDetail: async () => null,
    getProposalVotes: async () => [],
}))

import { DAORouter } from "./DAORouter"
import { CreateDAOGate } from "./CreateDAOGate"
// Warm the lazily loaded page so the first test does not spend its budget on transforms.
import "../../pages/DAOHome"

function mount(url: string) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
    return render(
        <QueryClientProvider client={client}>
            <MemoryRouter initialEntries={[url]}>
                <Routes>
                    <Route path="/:network/dao/create" element={<CreateDAOGate />} />
                    <Route path="/:network/dao/*" element={<DAORouter />} />
                </Routes>
            </MemoryRouter>
        </QueryClientProvider>,
    )
}

beforeEach(() => {
    state.kind = "govdao"
    state.members = []
})

describe("capability-driven DAO shell", () => {
    it("GovDAO on mainnet: no new proposal, treasury, channels or extensions, even for a member", async () => {
        state.kind = "govdao"
        state.members = [MEMBER]
        mount("/mainnet/dao/gno.land/r/gov/dao")
        await screen.findByText("gno.land/r/gov/dao", {}, { timeout: 10_000 })
        await waitFor(() => expect(screen.getAllByText(/Active Proposals/i).length).toBeGreaterThan(0))
        expect(screen.queryByRole("button", { name: /new proposal/i })).not.toBeInTheDocument()
        expect(screen.queryByRole("link", { name: /new proposal/i })).not.toBeInTheDocument()
        expect(screen.queryByText("Treasury")).not.toBeInTheDocument()
        expect(screen.queryByRole("button", { name: /discussion channels/i })).not.toBeInTheDocument()
        expect(screen.queryByText(/Extensions/)).not.toBeInTheDocument()
    })

    it("version-2 DAO on pearl: a non-member is not offered a new proposal", async () => {
        state.kind = "memba-v2"
        state.members = ["g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5"]
        mount("/pearl/dao/gno.land/r/alice/team")
        await screen.findByText("gno.land/r/alice/team", {}, { timeout: 10_000 })
        await waitFor(() => expect(screen.getAllByText(/Active Proposals/i).length).toBeGreaterThan(0))
        // Let the member list settle before asserting on membership-gated controls.
        await new Promise((r) => setTimeout(r, 50))
        expect(screen.queryByRole("button", { name: /new proposal/i })).not.toBeInTheDocument()
    })

    it("version-2 DAO on pearl: a member is offered a new proposal", async () => {
        state.kind = "memba-v2"
        state.members = [MEMBER]
        mount("/pearl/dao/gno.land/r/alice/team")
        expect(await screen.findByRole("button", { name: /new proposal/i })).toBeInTheDocument()
    })

    it("mainnet DAO creation is unavailable while creation is off", async () => {
        mount("/mainnet/dao/create")
        expect(await screen.findByRole("heading", { name: /not available/i })).toBeInTheDocument()
        expect(screen.queryByText("Create DAO form")).not.toBeInTheDocument()
    })

    it("pearl DAO creation stays available", async () => {
        mount("/pearl/dao/create")
        expect(await screen.findByText("Create DAO form")).toBeInTheDocument()
    })

    it("treasury is unavailable for every DAO", async () => {
        state.kind = "memba-v2"
        mount("/pearl/dao/gno.land/r/alice/team/treasury")
        expect(await screen.findByRole("heading", { name: /not available/i })).toBeInTheDocument()
    })

    it("plugin routes are unavailable", async () => {
        state.kind = "memba-v2"
        mount("/pearl/dao/gno.land/r/alice/team/plugin/board")
        expect(await screen.findByRole("heading", { name: /not available/i })).toBeInTheDocument()
    })

    it("channels are unavailable where the capability is off", async () => {
        state.kind = "govdao"
        mount("/mainnet/dao/gno.land/r/gov/dao/channels")
        expect(await screen.findByRole("heading", { name: /not available/i })).toBeInTheDocument()
        expect(screen.queryByText("Channels page")).not.toBeInTheDocument()
    })

    it("propose is unavailable for a DAO kind without proposal support", async () => {
        state.kind = "govdao"
        mount("/mainnet/dao/gno.land/r/gov/dao/propose")
        expect(await screen.findByRole("heading", { name: /not available/i })).toBeInTheDocument()
        expect(screen.queryByText("Propose form")).not.toBeInTheDocument()
    })
})
