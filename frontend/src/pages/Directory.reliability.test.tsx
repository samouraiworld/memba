import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { queryRender } from "../lib/dao/shared"
vi.mock("../lib/dao/shared", () => ({ queryRender: vi.fn() }))
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

function mount() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
    return render(<MemoryRouter><QueryClientProvider client={client}><Directory /></QueryClientProvider></MemoryRouter>)
}
function deferred() { let resolve!: (value: string) => void; const promise = new Promise<string>(r => { resolve = r }); return { promise, resolve } }
beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks() })
afterEach(() => { cleanup(); vi.useRealTimers() })
const type = (value: string) => fireEvent.change(screen.getByTestId("global-search"), { target: { value } })
describe("Directory request lifecycle", () => {
    it("ignores the earlier response when the next path finishes first", async () => {
        const a = deferred(), b = deferred()
        vi.mocked(queryRender).mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise)
        mount()
        type("gno.land/r/demo/alpha")
        await act(async () => { await vi.advanceTimersByTimeAsync(301) })
        type("gno.land/r/demo/beta")
        await act(async () => { await vi.advanceTimersByTimeAsync(301) })
        await act(async () => { b.resolve("Current beta response"); await vi.advanceTimersByTimeAsync(1) })
        await act(async () => { a.resolve("Stale alpha response"); await vi.advanceTimersByTimeAsync(1) })
        expect(screen.queryByText("Stale alpha response")).not.toBeInTheDocument()
        expect(screen.getByText("Current beta response")).toBeInTheDocument()
    })
    it("clears loading and cancels a pending debounce when search is cleared", async () => {
        const view = mount()
        type("gno.land/r/demo/alpha")
        type("")
        await act(async () => { await vi.advanceTimersByTimeAsync(301) })
        expect(queryRender).not.toHaveBeenCalled()
        expect(view.container.querySelector(".k-shimmer")).not.toBeInTheDocument()
        expect(screen.queryByText("Loading realm preview…")).not.toBeInTheDocument()
    })
    it("does not start a delayed read after unmount", async () => {
        vi.mocked(queryRender).mockResolvedValue("")
        const view = mount()
        type("gno.land/r/demo/alpha")
        view.unmount()
        await act(async () => { await vi.advanceTimersByTimeAsync(301) })
        expect(queryRender).not.toHaveBeenCalled()
    })
    it("does not attempt Render for a package path", async () => {
        vi.mocked(queryRender).mockResolvedValue("")
        mount()
        type("gno.land/p/demo/alpha")
        await act(async () => { await vi.advanceTimersByTimeAsync(301) })
        expect(queryRender).not.toHaveBeenCalled()
    })
})
