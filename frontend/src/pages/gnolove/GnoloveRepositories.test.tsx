import { describe, it, vi, expect, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import GnoloveRepositories from "./GnoloveRepositories"

const catalogue = vi.fn(), activity = vi.fn()
vi.mock("../../hooks/gnolove", () => ({ useGnoloveRepositories: () => catalogue() }))
vi.mock("../../lib/gnoloveRepositoryStats", () => ({ getRepositoryStats: (...args: unknown[]) => activity(...args) }))
vi.mock("../../hooks/useNetworkNav", () => ({ useNetworkPath: () => (path: string) => `/mainnet/${path}` }))
const repos = [{ id: "gnolang/gno", owner: "gnolang", name: "gno", baseBranch: "master", description: "Gno virtual machine" }, { id: "samouraiworld/memba", owner: "samouraiworld", name: "memba", baseBranch: "main", status: "active", stars: 0, lastSyncedAt: "2026-10-08T00:00:00Z" }]
function mount() { return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><GnoloveRepositories /></MemoryRouter></QueryClientProvider>) }
beforeEach(() => {
    catalogue.mockReturnValue({ data: repos, isLoading: false, isError: false, refetch: vi.fn() })
    activity.mockResolvedValue({ time: "monthly", repositories: [{ repositoryId: "samouraiworld/memba", mergedPRs: 67, openPRs: 2, contributors: 3 }] })
})
describe("repository catalogue", () => {
    it("groups, filters and opens the overview with a durable custom scope", async () => {
        mount()
        expect(screen.getByRole("region", { name: "gnolang repositories" })).toBeInTheDocument()
        expect(screen.getByRole("link", { name: "samouraiworld/memba" })).toHaveAttribute("href", "/mainnet/gnolove?repos=samouraiworld%2Fmemba")
        await screen.findByText("67")
        fireEvent.change(screen.getByRole("searchbox"), { target: { value: "virtual" } })
        expect(screen.queryByRole("link", { name: "samouraiworld/memba" })).toBeNull()
        fireEvent.change(screen.getByRole("searchbox"), { target: { value: "unknown" } })
        expect(screen.getByText("No repositories match your search.")).toBeInTheDocument()
    })
    it("keeps legacy catalogue fields usable and unavailable metrics as dashes", async () => {
        activity.mockRejectedValue(new Error("backend not deployed"))
        mount()
        expect(screen.getByText("Status unavailable")).toBeInTheDocument()
        await screen.findByText(/Repository activity is unavailable/)
        expect(screen.getAllByText("—").length).toBeGreaterThan(0)
    })
    it("distinguishes an empty catalogue from an outage and allows retry", async () => {
        const retry = vi.fn()
        catalogue.mockReturnValue({ isError: true, isLoading: false, refetch: retry })
        mount()
        fireEvent.click(screen.getByRole("button", { name: "Retry" }))
        expect(retry).toHaveBeenCalledOnce()
        expect(screen.queryByText("No repositories are tracked yet.")).toBeNull()
    })
    it("changes the activity period with the mouse", async () => {
        mount()
        fireEvent.click(screen.getByRole("tab", { name: /Week/ }))
        await waitFor(() => expect(activity).toHaveBeenLastCalledWith("weekly", expect.any(AbortSignal)))
    })
    it("changes the activity period with the keyboard", async () => {
        mount()
        const all = screen.getByRole("tab", { name: /All/ })
        fireEvent.keyDown(all, { key: "ArrowRight" })
        await waitFor(() => expect(screen.getByRole("tab", { name: /Year/ })).toHaveAttribute("aria-selected", "true"))
    })
})
