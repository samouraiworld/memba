/**
 * DAO names, descriptions, member labels and roles come from the chain. Unicode
 * format characters (zero-width, bidi overrides) in them must be shown as
 * visible [U+XXXX] markers on every DAO page, as proposals already do.
 */
import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter, Route, Routes } from "react-router-dom"

const ALICE = "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5"
const REALM = "gno.land/r/alice/team"
// "Team" with a right-to-left override, a description with a zero-width space.
const NAME = "Te\u202Eam"
const DESCRIPTION = "Pay\u200Bouts DAO"
const ROLE = "le\u2066ad"
const USERNAME = "@al\u200Dice"

vi.mock("react-router-dom", async (orig) => ({
    ...(await orig<typeof import("react-router-dom")>()),
    useOutletContext: () => ({ auth: { isAuthenticated: false, token: null }, adena: { address: "" } }),
}))
vi.mock("../hooks/useDaoKind", async () => {
    const { capabilitiesFor } = await import("../lib/dao/kind")
    const { NETWORKS } = await import("../lib/config")
    return { useDaoKind: () => ({ kind: "memba-v2", capabilities: capabilitiesFor("memba-v2", NETWORKS.pearl), loading: false, error: null }) }
})
vi.mock("../hooks/useUnvotedProposals", () => ({ useUnvotedProposals: () => ({ proposals: [] }) }))
vi.mock("../hooks/useNotifications", () => ({ useNotifications: () => ({ getDAOUnreadCount: () => 0 }) }))
vi.mock("../contexts/OrgContext", () => ({ useOrg: () => ({ activeOrgId: null, activeOrgName: "", isOrgMode: false }) }))
vi.mock("../components/ui/CopyableAddress", () => ({ CopyableAddress: ({ address }: { address: string }) => <span>{address}</span> }))
vi.mock("../lib/dao", async (orig) => ({
    ...(await orig<typeof import("../lib/dao")>()),
    getDAOConfig: async () => ({
        name: NAME, description: DESCRIPTION, threshold: "60%", memberCount: 1, memberstorePath: "", tierDistribution: [], isArchived: false,
        v2: {
            template_version: "memba-dao/2", api_version: "2.0", name: NAME, description: DESCRIPTION,
            threshold: 60, quorum: 0, voting_period: 86400, execution_delay: 3600, execution_window: 86400,
            categories: ["gov\u200Bernance"], roles: [ROLE], archived: false,
            member_count: 1, total_power: 1, electorate_version: 0, proposal_count: 0,
        },
    }),
    getDAOMembers: async () => [{ address: ALICE, username: USERNAME, votingPower: 1, roles: [ROLE], tier: "" }],
}))

import { DAOSettings } from "./DAOSettings"
import { DAOMembers } from "./DAOMembers"
import { DAOList } from "./DAOList"

function mount(url: string, path: string, element: React.ReactNode) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
    return render(
        <QueryClientProvider client={client}>
            <MemoryRouter initialEntries={[url]}>
                <Routes><Route path={path} element={element} /></Routes>
            </MemoryRouter>
        </QueryClientProvider>,
    )
}

const RAW = /[\u202E\u200B\u2066\u200D]/

describe("invisible formatting characters on DAO pages", () => {
    it("reveals them in the settings name, description, roles and categories", async () => {
        const { container } = mount(`/pearl/dao/${REALM}/settings`, "/:network/dao/*", <DAOSettings />)
        expect((await screen.findAllByText("Te[U+202E]am")).length).toBeGreaterThan(0)
        expect(screen.getByText("Pay[U+200B]outs DAO")).toBeInTheDocument()
        expect(screen.getByText("le[U+2066]ad")).toBeInTheDocument()
        expect(screen.getByText("gov[U+200B]ernance")).toBeInTheDocument()
        expect(container.textContent).not.toMatch(RAW)
    })

    it("reveals them in the members page DAO name, usernames and roles", async () => {
        const { container } = mount(`/pearl/dao/${REALM}/members`, "/:network/dao/*", <DAOMembers />)
        expect(await screen.findByText(/Te\[U\+202E\]am/)).toBeInTheDocument()
        expect(screen.getByText("@al[U+200D]ice")).toBeInTheDocument()
        expect(screen.getAllByText("le[U+2066]ad").length).toBeGreaterThan(0)
        expect(container.textContent).not.toMatch(RAW)
    })

    it("reveals them in the DAO list names and descriptions", async () => {
        const { container } = mount("/pearl/dao", "/:network/dao", <DAOList />)
        expect((await screen.findAllByText("Te[U+202E]am")).length).toBeGreaterThan(0)
        expect(screen.getAllByText("Pay[U+200B]outs DAO").length).toBeGreaterThan(0)
        expect(container.textContent).not.toMatch(RAW)
    })
})
