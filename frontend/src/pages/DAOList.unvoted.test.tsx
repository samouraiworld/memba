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
            { daoName: "Memba DAO", daoSlug: "gno.land~r~samcrew~memba_dao", realmPath: "gno.land/r/samcrew/memba_dao", proposalId: "18446744073709551615", proposalTitle: "Market config · set-fee", proposalStatus: "voting", readOnly: true, href: "/weighted-dao/gno.land/r/samcrew/memba_dao#proposal-18446744073709551615" },
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

it("opens weighted pending rows at their workspace href, keeping the exact uint64 ID", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
    render(<QueryClientProvider client={client}><MemoryRouter initialEntries={["/pearl/dao"]}><Routes><Route path="/:network/dao" element={<DAOList />} /></Routes></MemoryRouter></QueryClientProvider>)
    fireEvent.click(await screen.findByText(/#18446744073709551615: Market config · set-fee/))
    expect(navigate).toHaveBeenLastCalledWith("/weighted-dao/gno.land/r/samcrew/memba_dao#proposal-18446744073709551615")
    fireEvent.click(screen.getByText(/#3: Text/))
    expect(navigate).toHaveBeenLastCalledWith("/dao/gno.land~r~alice~team/proposal/3")
})
