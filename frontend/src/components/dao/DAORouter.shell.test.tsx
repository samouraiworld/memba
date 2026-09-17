import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import type { DaoKind } from "../../lib/dao/kind"
import type { MembaV2Config } from "../../lib/dao/membaV2"

const MEMBER = "g1manfred47kzduec920z88wfr64ylksmdcedlf5"
const state = vi.hoisted(() => ({ kind: "memba-v2" as DaoKind, archived: false }))

vi.mock("react-router-dom", async (orig) => ({
    ...(await orig<typeof import("react-router-dom")>()),
    useOutletContext: () => ({ auth: { isAuthenticated: true, token: null }, adena: { address: "g1manfred47kzduec920z88wfr64ylksmdcedlf5" } }),
}))
vi.mock("../../hooks/useDaoKind", async () => {
    const { capabilitiesFor } = await import("../../lib/dao/kind")
    const { NETWORKS } = await import("../../lib/config")
    const { useNetworkKey } = await import("../../hooks/useNetworkNav")
    return {
        useDaoKind: () => ({ kind: state.kind, capabilities: capabilitiesFor(state.kind, NETWORKS[useNetworkKey()]), loading: false, error: null }),
    }
})
vi.mock("../../lib/quests", () => ({ completeQuest: vi.fn(), trackPageVisit: vi.fn() }))
vi.mock("../../lib/profile", () => ({ resolveOnChainUsername: async () => "" }))
vi.mock("../../pages/ProposeDAO", () => ({ ProposeDAO: () => <div>Propose form</div> }))
vi.mock("../../pages/ProposalView", () => ({ ProposalView: () => <div>Proposal reader</div> }))

const V2_CONFIG: MembaV2Config = {
    template_version: "memba-dao/2", api_version: "2.0", name: "Team DAO", description: "Builders",
    threshold: 60, quorum: 20, voting_period: 3 * 86400, execution_delay: 3600, execution_window: 7 * 86400,
    categories: ["governance", "ops"], roles: ["lead", "member"], archived: false,
    member_count: 2, total_power: 3, electorate_version: 4, proposal_count: 9,
}

vi.mock("../../lib/dao", async (orig) => ({
    ...(await orig<typeof import("../../lib/dao")>()),
    getDAOConfig: async () => ({
        name: "Team DAO", description: "Builders", threshold: "60%", memberCount: 2, memberstorePath: "", tierDistribution: [], isArchived: state.archived,
        v2: state.kind === "memba-v2" ? { ...V2_CONFIG, archived: state.archived } : undefined,
    }),
    getDAOMembers: async () => [{ address: MEMBER, roles: [], tier: "", votingPower: 2, username: "" }],
    getDAOProposals: async () => [],
    getProposalDetail: async () => null,
    getProposalVotes: async () => [],
}))

import { DAORouter } from "./DAORouter"
import "../../pages/DAOHome"
import "../../pages/DAOSettings"

function mount(url: string) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
    return render(
        <QueryClientProvider client={client}>
            <MemoryRouter initialEntries={[url]}>
                <Routes>
                    <Route path="/:network/dao/*" element={<DAORouter />} />
                </Routes>
            </MemoryRouter>
        </QueryClientProvider>,
    )
}

beforeEach(() => {
    state.kind = "memba-v2"
    state.archived = false
})

describe("DAO shell sections", () => {
    it("a version-2 DAO has Overview, Proposals, Members and Settings sections", async () => {
        mount("/pearl/dao/gno.land/r/alice/team")
        const nav = await screen.findByRole("navigation", { name: "DAO sections" })
        const links = within(nav).getAllByRole("link").map((l) => l.textContent)
        expect(links).toEqual(["Overview", "Proposals", "Members", "Settings"])
        expect(within(nav).getByRole("link", { name: "Overview" })).toHaveAttribute("aria-current", "page")
        expect(within(nav).getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/pearl/dao/gno.land/r/alice/team/settings")
    })

    it("GovDAO has no Settings section and its settings URL is unavailable", async () => {
        state.kind = "govdao"
        mount("/mainnet/dao/gno.land/r/gov/dao/settings")
        expect(await screen.findByRole("heading", { name: /not available/i })).toBeInTheDocument()
        const nav = screen.getByRole("navigation", { name: "DAO sections" })
        expect(within(nav).queryByRole("link", { name: "Settings" })).not.toBeInTheDocument()
    })

    it("the Proposals section lists proposals without the overview card", async () => {
        mount("/pearl/dao/gno.land/r/alice/team/proposals")
        const nav = await screen.findByRole("navigation", { name: "DAO sections" })
        expect(within(nav).getByRole("link", { name: "Proposals" })).toHaveAttribute("aria-current", "page")
        expect((await screen.findAllByText(/Active Proposals/i)).length).toBeGreaterThan(0)
        expect(screen.queryByRole("heading", { name: "Team DAO", level: 2 })).not.toBeInTheDocument()
    })

    it("the Settings section shows the version-2 rules read-only", async () => {
        mount("/pearl/dao/gno.land/r/alice/team/settings")
        expect(await screen.findByRole("heading", { name: "Settings" })).toBeInTheDocument()
        expect(screen.getByText("memba-dao/2")).toBeInTheDocument()
        expect(screen.getByText("60% of all voting power")).toBeInTheDocument()
        expect(screen.getByText("20% of all voting power must vote")).toBeInTheDocument()
        expect(screen.getByText("3 days")).toBeInTheDocument()
        expect(screen.getByText("1 hour")).toBeInTheDocument()
        expect(screen.getByText("7 days")).toBeInTheDocument()
        expect(screen.getByText("governance, ops")).toBeInTheDocument()
        expect(screen.getByText(/Roles are labels; they grant no special powers/)).toBeInTheDocument()
        expect(screen.getByText(/Rules are permanent; to change them, create a new DAO and move members by proposal/)).toBeInTheDocument()
        expect(screen.getByRole("link", { name: /view source/i })).toBeInTheDocument()
        expect(screen.queryByRole("textbox")).not.toBeInTheDocument()
        expect(screen.queryByRole("button", { name: /save|edit/i })).not.toBeInTheDocument()
    })

    it("an archived DAO says so in Settings", async () => {
        state.archived = true
        mount("/pearl/dao/gno.land/r/alice/team/settings")
        expect(await screen.findByText(/This DAO is archived/)).toBeInTheDocument()
    })

    it("proposal pages keep the section navigation", async () => {
        mount("/pearl/dao/gno.land/r/alice/team/proposal/3")
        expect(await screen.findByText("Proposal reader")).toBeInTheDocument()
        expect(screen.getByRole("navigation", { name: "DAO sections" })).toBeInTheDocument()
    })
})
