import { expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter, Route, Routes } from "react-router-dom"

const navigate = vi.hoisted(() => vi.fn())
vi.mock("react-router-dom", async (orig) => ({
    ...(await orig<typeof import("react-router-dom")>()),
    useOutletContext: () => ({ auth: { isAuthenticated: true, token: null, address: "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5" }, adena: { address: "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5" } }),
}))
vi.mock("../hooks/useNetworkNav", async (orig) => ({ ...(await orig<typeof import("../hooks/useNetworkNav")>()), useNetworkNav: () => navigate }))
vi.mock("../hooks/useUnvotedProposals", () => ({
    useUnvotedProposals: () => ({
        proposals: [
            { daoName: "Team", daoSlug: "gno.land~r~alice~team", realmPath: "gno.land/r/alice/team", proposalId: 3, proposalTitle: "Text", proposalStatus: "open" },
        ],
    }),
}))
vi.mock("../hooks/useNotifications", () => ({ useNotifications: () => ({ getDAOUnreadCount: () => 0 }) }))
vi.mock("../contexts/OrgContext", () => ({ useOrg: () => ({ activeOrgId: null, activeOrgName: "", isOrgMode: false }) }))
vi.mock("../lib/dao", async (orig) => ({
    ...(await orig<typeof import("../lib/dao")>()),
    getDAOConfig: async (_rpc: string, path: string) => ({ name: path.split("/").pop(), description: "", threshold: "", memberCount: 0, memberstorePath: "", tierDistribution: [], isArchived: false }),
}))
vi.mock("../lib/rpcFallback", async (orig) => ({
    ...(await orig<typeof import("../lib/rpcFallback")>()),
    directRpcCall: async () => { throw new Error("offline") },
}))

import { DAOList } from "./DAOList"

it("opens a pending row at its proposal page", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
    render(<QueryClientProvider client={client}><MemoryRouter initialEntries={["/pearl/dao"]}><Routes><Route path="/:network/dao" element={<DAOList />} /></Routes></MemoryRouter></QueryClientProvider>)
    expect(await screen.findByText(/1 proposal needs your vote/)).toBeTruthy()
    fireEvent.click(screen.getByText(/#3: Text/))
    expect(navigate).toHaveBeenLastCalledWith("/dao/gno.land~r~alice~team/proposal/3")
})
