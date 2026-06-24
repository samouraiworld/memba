import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { TeamHub } from "./TeamHub"

const TEAMS = [
    { slug: "core", name: "Core", color: "purple" as const, description: "Core team", members: ["alice", "bob"] },
    { slug: "onbloc", name: "Onbloc", color: "blue" as const, description: "Onbloc team", members: ["notjoon"] },
]

vi.mock("../../../hooks/gnolove", () => ({
    useGnoloveTeams: () => ({ teams: TEAMS, lastSyncedAt: "2026-05-20T10:00:00Z" }),
    useGnoloveTeamActiveRepos: () => ({ data: null, isLoading: false, isError: false, dataUpdatedAt: 0 }),
    useGnoloveTeamStats: () => ({ data: null, isLoading: false, isError: false, dataUpdatedAt: 0, refetch: vi.fn() }),
    useTeamProfileUrlState: () => ({ period: "monthly", repos: [], setPeriod: vi.fn() }),
    useGnoloveBackendHealth: () => "up",
    useGnoloveAIReports: () => ({ data: null, isLoading: false }),
    useGnoloveYearReport: () => ({ data: null, isLoading: false }),
    useGnoloveTopics: () => ({ rules: [], labels: {} }),
}))

vi.mock("../../../hooks/useNetwork", () => ({
    useNetwork: () => ({ networkKey: "gnoland1" }),
}))

vi.mock("../../../hooks/useNetworkNav", () => ({
    useNetworkPath: () => (path: string) => `/gnoland1/${path}`,
    useNetworkKey: () => "gnoland1",
}))

function renderHub(teamName: string) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return render(
        <QueryClientProvider client={client}>
            <MemoryRouter initialEntries={[`/gnoland1/gnolove/teams/${teamName}`]}>
                <Routes>
                    <Route path="/gnoland1/gnolove/teams/:teamName" element={<TeamHub />} />
                </Routes>
            </MemoryRouter>
        </QueryClientProvider>,
    )
}

describe("TeamHub", () => {
    it("renders team-not-found for unknown team slug", () => {
        renderHub("nonexistent")
        expect(screen.getByText(/Team not found.*nonexistent/)).toBeInTheDocument()
        expect(screen.getByText(/See all teams/)).toBeInTheDocument()
    })

    it("renders the team name for a valid slug", () => {
        renderHub("core")
        expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Core")
    })

    it("decodes URL-encoded team names", () => {
        renderHub(encodeURIComponent("onbloc"))
        expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Onbloc")
    })

    it("matches teams case-insensitively", () => {
        renderHub("CORE")
        expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Core")
    })

    it("renders all card sections on happy path", () => {
        const { container } = renderHub("core")
        expect(container.querySelector(".gl-thub-page")).toBeInTheDocument()
        expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Core")
    })
})
