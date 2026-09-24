import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom"
import type { DaoKind } from "../../lib/dao/kind"

const state = vi.hoisted(() => ({ kind: null as DaoKind | null, loading: false }))
vi.mock("../../hooks/useDaoKind", async () => {
    const { capabilitiesFor } = await import("../../lib/dao/kind")
    const { NETWORKS } = await import("../../lib/config")
    return { useDaoKind: () => ({ kind: state.kind, capabilities: capabilitiesFor(state.kind ?? "unknown", NETWORKS.mainnet), loading: state.loading, error: null }) }
})
vi.mock("../../pages/DAOHome", () => ({ DAOHome: () => <div>Legacy DAO home</div> }))
vi.mock("../../pages/DAOMembers", () => ({ DAOMembers: () => <div>Legacy members</div> }))

import { DAORouter } from "./DAORouter"

function Workspace() { return <div>Weighted workspace at {useLocation().pathname}</div> }
function mount(url: string) {
    return render(<MemoryRouter initialEntries={[url]}><Routes>
        <Route path="/:network/dao/*" element={<DAORouter />} />
        <Route path="/:network/weighted-dao/*" element={<Workspace />} />
    </Routes></MemoryRouter>)
}

describe("weighted DAO routing", () => {
    beforeEach(() => { state.kind = null; state.loading = false })

    it("sends a weighted realm from the DAO shell to its workspace", async () => {
        state.kind = "weighted"
        mount("/mainnet/dao/gno.land/r/samcrew/memba_dao")
        expect(await screen.findByText("Weighted workspace at /mainnet/weighted-dao/gno.land/r/samcrew/memba_dao")).toBeInTheDocument()
        expect(screen.queryByText("Legacy DAO home")).not.toBeInTheDocument()
    })

    it("redirects shell sub-routes too, keeping the network", async () => {
        state.kind = "weighted"
        mount("/pearl/dao/gno.land/r/samcrew/memba_dao/members")
        expect(await screen.findByText("Weighted workspace at /pearl/weighted-dao/gno.land/r/samcrew/memba_dao")).toBeInTheDocument()
    })

    it("keeps other kinds, and unresolved kinds, in the shell", async () => {
        for (const kind of ["daokit", "unknown", null] as const) {
            state.kind = kind
            const view = mount("/mainnet/dao/gno.land/r/samcrew/memba_dao")
            expect(await screen.findByText("Legacy DAO home")).toBeInTheDocument()
            expect(screen.queryByText(/Weighted workspace/)).not.toBeInTheDocument()
            view.unmount()
        }
    })
})
