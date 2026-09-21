import { beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter, Route, Routes } from "react-router-dom"

const state = vi.hoisted(() => ({ statuses: {} as Record<string, "live" | "inert" | "absent" | "error"> }))

vi.mock("react-router-dom", async (orig) => ({
    ...(await orig<typeof import("react-router-dom")>()),
    useOutletContext: () => ({ auth: { isAuthenticated: false, token: null }, adena: { address: "" } }),
}))
vi.mock("../hooks/useUnvotedProposals", () => ({ useUnvotedProposals: () => ({ proposals: [] }) }))
vi.mock("../hooks/useNotifications", () => ({ useNotifications: () => ({ getDAOUnreadCount: () => 0 }) }))
vi.mock("../contexts/OrgContext", () => ({ useOrg: () => ({ activeOrgId: null, activeOrgName: "", isOrgMode: false }) }))
vi.mock("../lib/dao", async (orig) => ({
    ...(await orig<typeof import("../lib/dao")>()),
    getDAOConfig: async (_rpc: string, path: string) => ({ name: path.split("/").pop(), description: "", threshold: "", memberCount: 0, memberstorePath: "", tierDistribution: [], isArchived: false }),
}))
// Package status reads go to the node; each path answers as the test sets it.
vi.mock("../lib/rpcFallback", async (orig) => ({
    ...(await orig<typeof import("../lib/rpcFallback")>()),
    directRpcCall: async (_url: string, method: string, params: Record<string, string>) => {
        const { GNO_CHAIN_ID: chainId } = await import("../lib/config")
        if (method === "status") return { node_info: { network: chainId } }
        const path = new TextDecoder().decode(Uint8Array.from(params.data.slice(2).match(/../g) ?? [], (h) => parseInt(h, 16)))
        const status = state.statuses[path]
        if (status === undefined || status === "error") throw new Error("down")
        const meta = status === "inert"
            ? { path, status, creator: "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5", reason: "waiting for a package approver to enable it", pending: true }
            : { path, status }
        return { response: { ResponseBase: { Data: btoa(JSON.stringify(meta)), Error: null } } }
    },
}))

import { DAOList } from "./DAOList"
import { GNO_CHAIN_ID } from "../lib/config"
import { listPendingDAOs, savePendingDAO } from "../lib/dao/packageStatus"
import { getSavedDAOs } from "../lib/daoSlug"

const PARKED = "gno.land/r/alice/parked_dao"
const ENABLED = "gno.land/r/alice/enabled_dao"
const MISSING = "gno.land/r/alice/missing_dao"

function mount() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
    return render(
        <QueryClientProvider client={client}>
            <MemoryRouter initialEntries={["/pearl/dao"]}>
                <Routes><Route path="/:network/dao" element={<DAOList />} /></Routes>
            </MemoryRouter>
        </QueryClientProvider>,
    )
}

beforeEach(() => {
    localStorage.clear()
    state.statuses = {}
})

describe("My DAOs: deploys waiting for the network", () => {
    it("re-checks pending DAOs on open, keeps parked ones and turns enabled ones into normal entries", async () => {
        savePendingDAO({ chainId: GNO_CHAIN_ID, path: PARKED, name: "Parked", txHash: "a".repeat(64), reason: "submitted" })
        savePendingDAO({ chainId: GNO_CHAIN_ID, path: ENABLED, name: "Enabled", txHash: "b".repeat(64), reason: "submitted" })
        state.statuses = { [PARKED]: "inert", [ENABLED]: "live" }
        mount()
        const section = await screen.findByRole("region", { name: "DAO submissions" })
        await waitFor(() => expect(within(section).getByText("Not enabled yet: waiting for a package approver to enable it")).toBeInTheDocument())
        expect(within(section).queryByText(ENABLED)).not.toBeInTheDocument()
        expect(within(section).getByText("a".repeat(64))).toBeInTheDocument()
        expect(listPendingDAOs(GNO_CHAIN_ID).map((p) => p.path)).toEqual([PARKED])
        expect(getSavedDAOs().map((d) => d.realmPath)).toContain(ENABLED)
        expect(await screen.findByRole("link", { name: "enabled_dao" })).toHaveAttribute("href", `/pearl/dao/${ENABLED}`)
    })

    it("retains a live receipt when the real bookmark storage write fails", async () => {
        savePendingDAO({ chainId: GNO_CHAIN_ID, path: ENABLED, name: "Enabled", txHash: "KEEP", reason: "submitted" })
        state.statuses = { [ENABLED]: "live" }
        const original = localStorage.setItem.bind(localStorage)
        const write = vi.spyOn(localStorage, "setItem").mockImplementation((key, value) => {
            if (key === "memba_saved_daos") throw new Error("quota")
            original(key, value)
        })
        mount()
        expect(await screen.findByText(/The DAO is live, but could not be saved/)).toBeInTheDocument()
        expect(listPendingDAOs(GNO_CHAIN_ID)[0].txHash).toBe("KEEP")
        write.mockRestore()
        fireEvent.click(screen.getByRole("button", { name: "Check again" }))
        await waitFor(() => expect(listPendingDAOs(GNO_CHAIN_ID)).toEqual([]))
        expect(getSavedDAOs().map(d => d.realmPath)).toContain(ENABLED)
    })

    it("offers to drop a submission the network does not have, and re-checks on demand", async () => {
        savePendingDAO({ chainId: GNO_CHAIN_ID, path: MISSING, name: "Missing", txHash: "", reason: "submitted" })
        state.statuses = { [MISSING]: "error" }
        mount()
        const section = await screen.findByRole("region", { name: "DAO submissions" })
        expect(await within(section).findByText("The status could not be read. Try again later.")).toBeInTheDocument()
        state.statuses = { [MISSING]: "absent" }
        fireEvent.click(within(section).getByRole("button", { name: "Check again" }))
        expect(await within(section).findByText(/The network has no package at this path/)).toBeInTheDocument()
        fireEvent.click(within(section).getByRole("button", { name: "Remove from this list" }))
        await waitFor(() => expect(screen.queryByRole("region", { name: "DAO submissions" })).not.toBeInTheDocument())
    })

    it("shows no pending section when nothing is pending, and DAO cards hold no nested controls", async () => {
        mount()
        const link = (await screen.findAllByRole("link")).find((a) => a.classList.contains("k-dao-card__link"))!
        expect(screen.queryByRole("region", { name: "DAO submissions" })).not.toBeInTheDocument()
        expect(link.querySelector("a, button")).toBeNull()
        expect(link.closest("a")?.parentElement?.closest("a, button")).toBeNull()
    })
})
