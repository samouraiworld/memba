/**
 * GnoloveAnalytics — period tablist keyboard wiring.
 *
 * First test file for this page; scoped to the tablist adoption. The APG
 * keyboard contract itself is covered in hooks/useTabListKeyboard.test.tsx —
 * these pin that the page is wired through the hook (roving tabindex, and
 * arrow-selection reaching setPeriod's URL write).
 */
import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent, within } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"

vi.mock("../../hooks/gnolove", async () => {
    const actual = await vi.importActual<typeof import("../../hooks/gnolove")>("../../hooks/gnolove")
    const empty = { data: undefined, isLoading: false, isError: false, refetch: () => {} }
    return {
        ...actual,
        useGnoloveContributors: vi.fn(() => empty),
        useGnoloveProposals: vi.fn(() => empty),
        useGnoloveGovdaoMembers: vi.fn(() => empty),
        useGnolovePackages: vi.fn(() => empty),
        useGnoloveNamespaces: vi.fn(() => empty),
        useGnoloveRepoActivity: vi.fn(() => empty),
        useGnoloveMonthlyActivity: vi.fn(() => empty),
        useGnoloveYearReport: vi.fn(() => empty),
        useGnoloveTopics: vi.fn(() => ({ rules: [], labels: [] })),
        useGnoloveTeams: vi.fn(() => ({ teams: [], lastSyncedAt: null })),
        useGnoloveCohorts: vi.fn(() => empty),
        useGnoloveTeamCollab: vi.fn(() => empty),
    }
})

vi.mock("../../hooks/useNetworkNav", () => ({
    useNetworkKey: () => "test12",
    useNetworkNav: () => () => {},
    useNetworkPath: () => (p: string) => `/test12/${p}`,
}))

import GnoloveAnalytics from "./GnoloveAnalytics"

function renderPage() {
    return render(
        <MemoryRouter initialEntries={["/test12/gnolove/insights"]}>
            <GnoloveAnalytics />
        </MemoryRouter>,
    )
}

describe("GnoloveAnalytics — period tablist keyboard (APG)", () => {
    it("gives the periods a roving tabindex (single tab stop)", () => {
        renderPage()
        const tablist = screen.getByRole("tablist", { name: "Time period" })
        const tabs = within(tablist).getAllByRole("tab")
        expect(tabs.filter(t => t.getAttribute("tabindex") === "0")).toHaveLength(1)
        // No ?time= param → ALL_TIME is the page's default.
        expect(within(tablist).getByRole("tab", { name: "All Time" })).toHaveAttribute("tabindex", "0")
    })

    it("ArrowRight moves selection All Time → This Year", () => {
        renderPage()
        const tablist = screen.getByRole("tablist", { name: "Time period" })
        fireEvent.keyDown(within(tablist).getByRole("tab", { name: "All Time" }), { key: "ArrowRight" })
        const year = within(tablist).getByRole("tab", { name: "This Year" })
        expect(year).toHaveAttribute("aria-selected", "true")
        expect(year).toHaveAttribute("tabindex", "0")
    })
})
