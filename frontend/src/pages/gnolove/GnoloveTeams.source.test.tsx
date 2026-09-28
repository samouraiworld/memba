import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import GnoloveTeams from "./GnoloveTeams"

const mockTeams = vi.fn()
vi.mock("../../hooks/gnolove", () => ({
    useGnoloveTeams: () => mockTeams(),
    useGnoloveContributors: () => ({ data: undefined }),
}))
vi.mock("../../hooks/useNetworkNav", () => ({ useNetworkPath: () => (path: string) => `/mainnet/${path}` }))

const team = { slug: "core", name: "Core", color: "purple", description: "Core contributors", members: ["alice"] }

describe("GnoloveTeams roster provenance", () => {
    it("labels the built-in roster when the live backend is unavailable", () => {
        mockTeams.mockReturnValue({ teams: [team], isFetched: false, isLoading: false, error: new Error("offline"), lastSyncedAt: null })
        render(<MemoryRouter><GnoloveTeams /></MemoryRouter>)
        expect(screen.getByRole("alert")).toHaveTextContent("built-in team roster")
        expect(screen.getByRole("heading", { name: "Teams" })).toBeInTheDocument()
    })

    it("does not label a fetched roster as built-in", () => {
        mockTeams.mockReturnValue({ teams: [team], isFetched: true, isLoading: false, error: null, lastSyncedAt: "2026-09-28T01:00:00Z" })
        render(<MemoryRouter><GnoloveTeams /></MemoryRouter>)
        expect(screen.queryByText(/built-in team roster/)).toBeNull()
        expect(screen.getByText(/Roster updated:/)).toBeInTheDocument()
    })
})
