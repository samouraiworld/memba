import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter } from "react-router-dom"

const state = vi.hoisted(() => ({ archived: false, configAvailable: true, broadcast: vi.fn() }))
vi.mock("react-router-dom", async original => ({ ...await original<typeof import("react-router-dom")>(), useOutletContext: () => ({ auth: { isAuthenticated: true }, adena: { address: "g1alice" } }) }))
vi.mock("../hooks/useDaoRoute", () => ({ useDaoRoute: () => ({ realmPath: "gno.land/r/team/dao", encodedSlug: "team-dao" }) }))
vi.mock("../hooks/useNetworkNav", () => ({ useNetworkNav: () => vi.fn() }))
vi.mock("../components/ui/CopyableAddress", () => ({ CopyableAddress: ({ address }: { address: string }) => <span>{address}</span> }))
vi.mock("../lib/dao", async original => ({
    ...await original<typeof import("../lib/dao")>(),
    getDAOConfig: async () => state.configAvailable ? { name: "Team", isArchived: state.archived, tierDistribution: [] } : null,
    getDAOMembers: async () => [
        { address: "g1alice", username: "alice", power: 1, roles: ["admin"], tier: "" },
        { address: "g1bob", username: "bob", power: 1, roles: ["member"], tier: "" },
    ],
}))
vi.mock("../lib/grc20", async original => ({ ...await original<typeof import("../lib/grc20")>(), doContractBroadcast: state.broadcast }))
import { DAOMembers } from "./DAOMembers"
function mount() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
    return render(<QueryClientProvider client={client}><MemoryRouter><DAOMembers /></MemoryRouter></QueryClientProvider>)
}
beforeEach(() => { state.archived = false; state.configAvailable = true; state.broadcast.mockReset().mockResolvedValue(undefined) })
describe("DAO member list", () => {
    it("offers no unilateral role changes, even to an admin", async () => {
        mount()
        await screen.findByText("g1bob", { exact: true })
        expect(screen.queryByTitle("Manage roles")).not.toBeInTheDocument()
        expect(screen.queryByRole("button", { name: "+ dev", exact: true })).not.toBeInTheDocument()
        expect(screen.queryByTitle("Remove member role")).not.toBeInTheDocument()
        expect(state.broadcast).not.toHaveBeenCalled()
    })
    it("keeps archived membership readable", async () => {
        state.archived = true; mount()
        await screen.findByText("This DAO is archived.")
        expect(screen.getByText("g1bob", { exact: true })).toBeInTheDocument()
        expect(state.broadcast).not.toHaveBeenCalled()
    })
    it("still lists members when DAO configuration cannot be verified", async () => {
        state.configAvailable = false; mount()
        await screen.findByText("g1bob", { exact: true })
        expect(state.broadcast).not.toHaveBeenCalled()
    })
})
