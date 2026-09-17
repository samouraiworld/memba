import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter, Route, Routes } from "react-router-dom"

const ALICE = "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5"
const BOB = "g1747t5m2f08plqjlrjk2q0qld7465hxz8gkx59c"
const REALM = "gno.land/r/alice/team"
const state = vi.hoisted(() => ({ address: "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5", archived: false, roles: ["lead", "member"] }))

vi.mock("react-router-dom", async (orig) => ({ ...(await orig<typeof import("react-router-dom")>()), useOutletContext: () => ({ auth: { isAuthenticated: true }, adena: { address: state.address } }) }))
vi.mock("../hooks/useDaoKind", async () => {
    const { capabilitiesFor } = await import("../lib/dao/kind")
    const { NETWORKS } = await import("../lib/config")
    return { useDaoKind: () => ({ kind: "memba-v2", capabilities: capabilitiesFor("memba-v2", NETWORKS.pearl), loading: false, error: null }) }
})
vi.mock("../components/ui/CopyableAddress", () => ({ CopyableAddress: ({ address }: { address: string }) => <span>{address}</span> }))
vi.mock("../lib/dao", async (orig) => ({
    ...(await orig<typeof import("../lib/dao")>()),
    getDAOConfig: async () => ({ name: "Team", description: "", threshold: "60%", memberCount: 2, memberstorePath: "", tierDistribution: [], isArchived: state.archived, v2: { roles: state.roles, archived: state.archived } }),
    getDAOMembers: async () => [
        { address: ALICE, username: "", votingPower: 2_000, roles: ["lead"], tier: "" },
        { address: BOB, username: "", votingPower: 1, roles: [], tier: "" },
    ],
}))

import { DAOMembers } from "./DAOMembers"

function mount() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
    return render(
        <QueryClientProvider client={client}>
            <MemoryRouter initialEntries={[`/pearl/dao/${REALM}/members`]}>
                <Routes><Route path="/:network/dao/*" element={<DAOMembers />} /></Routes>
            </MemoryRouter>
        </QueryClientProvider>,
    )
}

beforeEach(() => {
    state.address = ALICE
    state.archived = false
    state.roles = ["lead", "member"]
})

describe("version-2 DAO members page", () => {
    it("shows voting power and links members to prefilled role-change and removal proposals", async () => {
        mount()
        const row = (await screen.findByText(BOB)).closest(".k-members__row") as HTMLElement
        expect(screen.getByRole("heading", { name: "Members" })).toBeInTheDocument()
        expect(screen.getByText("Voting power")).toBeInTheDocument()
        expect(screen.getByLabelText("Voting power 2,000")).toBeInTheDocument()
        expect(within(row).getByRole("link", { name: "Propose role change" })).toHaveAttribute("href", `/pearl/dao/${REALM}/propose?type=change_role&target=${BOB}`)
        expect(within(row).getByRole("link", { name: "Propose removal" })).toHaveAttribute("href", `/pearl/dao/${REALM}/propose?type=remove_member&target=${BOB}`)
        expect(screen.getByRole("link", { name: "Propose a new member" })).toHaveAttribute("href", `/pearl/dao/${REALM}/propose?type=add_member`)
        expect(screen.queryByRole("button", { name: /assign|remove role|manage/i })).not.toBeInTheDocument()
    })

    it("offers no role change when the DAO defines no roles", async () => {
        state.roles = []
        mount()
        await screen.findByText(BOB)
        expect(screen.queryByRole("link", { name: "Propose role change" })).not.toBeInTheDocument()
        expect(screen.getAllByRole("link", { name: "Propose removal" })).toHaveLength(2)
    })

    it("offers no proposals to non-members or in an archived DAO", async () => {
        state.address = "g1u7y667z64x2h7vc6fmpcprgey4ck233jaww9zq"
        const { unmount } = mount()
        await screen.findByText(BOB)
        expect(screen.queryByRole("link", { name: /Propose/ })).not.toBeInTheDocument()
        unmount()
        state.address = ALICE
        state.archived = true
        mount()
        await screen.findByText(BOB)
        expect(screen.queryByRole("link", { name: /Propose/ })).not.toBeInTheDocument()
    })
})
