import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom"
const options = vi.hoisted(() => ({ explorer: true }))
vi.mock("../lib/config", async importOriginal => ({ ...await importOriginal<typeof import("../lib/config")>(), isExplorerEnabled: () => options.explorer }))
vi.mock("../lib/quests", () => ({ trackPageVisit: vi.fn(), trackDirectoryTab: vi.fn() }))
vi.mock("../components/directory", () => ({ ChainMetricsBanner: () => null }))
vi.mock("../hooks/useDirectoryDiscovery", () => ({ useDirectoryDiscovery: () => ({ discovery: { status: "ready", packages: [{ name: "Boards package", path: "gno.land/p/demo/boards2", description: "reference" }], realms: [{ name: "Boards", path: "gno.land/r/gnoland/boards2/v0", description: "forum" }] }, isPending: false, refetch: vi.fn() }) }))
vi.mock("../components/directory/tabs", () => ({
    DAOsTab: () => null, TokensTab: () => null, UsersTab: () => null, PackagesTab: () => null, RealmsTab: () => null, GovDAOTab: () => null, LeaderboardTab: () => null,
    ExplorerTab: ({ realm }: { realm: string }) => <output data-testid="selected-explorer">{realm}</output>,
}))
vi.mock("../components/directory/RealmDetailDrawer", () => ({ RealmDetailDrawer: ({ path, isPackage }: { path: string; isPackage: boolean }) => <output data-testid="selected-drawer">{path}:{isPackage ? "source" : "render"}</output> }))
import { Directory } from "./Directory"
function History() { const location = useLocation(); const navigate = useNavigate(); return <><output data-testid="url">{location.pathname}{location.search}</output><button onClick={() => navigate(-1)}>Back</button></> }
describe("Directory selected search destinations", () => {
    it.each([true, false])("keeps query and exact realm through selection and Back, explorer=%s", async enabled => {
        options.explorer = enabled
        render(<MemoryRouter initialEntries={["/mainnet/directory?q=Boards"]}><Directory /><History /></MemoryRouter>)
        fireEvent.click(await screen.findByRole("button", { name: /gno.land\/r\/gnoland\/boards2\/v0/ }))
        expect(screen.getByTestId(enabled ? "selected-explorer" : "selected-drawer")).toHaveTextContent("r/gnoland/boards2/v0")
        expect(screen.getByTestId("url")).toHaveTextContent("q=Boards")
        expect(screen.getByTestId("url")).toHaveTextContent("/mainnet/directory")
        fireEvent.click(screen.getByRole("button", { name: "Back" }))
        expect(screen.queryByTestId(enabled ? "selected-explorer" : "selected-drawer")).not.toBeInTheDocument()
        expect(screen.getByTestId("global-search")).toHaveValue("Boards")
    })
    it("opens a package as source in the flag-off fallback", async () => {
        options.explorer = false
        render(<MemoryRouter initialEntries={["/pearl/directory?q=Boards"]}><Directory /><History /></MemoryRouter>)
        fireEvent.click(await screen.findByRole("button", { name: /gno.land\/p\/demo\/boards2/ }))
        expect(screen.getByTestId("selected-drawer")).toHaveTextContent("gno.land/p/demo/boards2:source")
        expect(screen.getByTestId("url")).toHaveTextContent("/pearl/directory")
    })
})
