import { render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter, Navigate, Route, Routes, useLocation } from "react-router-dom"
import { describe, expect, it, vi } from "vitest"
import type { LayoutContext } from "../../types/layout"

// A DAO page that turns out to be weighted replaces its address, as DAORouter does.
vi.mock("../../routes/networkRoutes", () => ({
    networkRouteChildren: () => <Route path="*" element={<Navigate to="/mainnet/weighted-dao/gno.land/r/alice/team" replace />} />,
}))
const { ClassicPage } = await import("./ClassicPage")

function Where() {
    return <p>at {useLocation().pathname}</p>
}

function show(active: boolean) {
    const onReplace = vi.fn()
    render(
        <MemoryRouter initialEntries={["/os/daos/dao/gno.land/r/alice/team/settings"]}>
            <Where />
            <Routes>
                <Route path="*" element={<ClassicPage network="mainnet" page="dao/gno.land/r/alice/team/settings" layout={{} as LayoutContext} active={active} onReplace={onReplace} />} />
            </Routes>
        </MemoryRouter>,
    )
    return onReplace
}

describe("a classic page that replaces its own address", () => {
    it("retargets its window to the new view, which takes the address when the window is in front", async () => {
        const onReplace = show(true)
        await waitFor(() => expect(onReplace).toHaveBeenCalledWith(expect.objectContaining({ key: "dao:alice.team" })))
        expect(await screen.findByText("at /os/dao/alice.team")).toBeInTheDocument()
    })

    it("retargets a background window without taking the address", async () => {
        const onReplace = show(false)
        await waitFor(() => expect(onReplace).toHaveBeenCalledWith(expect.objectContaining({ key: "dao:alice.team" })))
        expect(screen.getByText("at /os/daos/dao/gno.land/r/alice/team/settings")).toBeInTheDocument()
    })
})
