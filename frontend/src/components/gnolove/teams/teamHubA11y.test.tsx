/**
 * Smoke tests for the Phase-7 / v6.2.1 UX polish:
 * - period selector uses the tablist pattern from GnoloveReport
 * - cards expose aria-live regions so screen readers announce period changes
 * - loading states set aria-busy and shape-fidelity skeleton markup
 *
 * Not exhaustive — just locks the explicitly-shipped a11y promises in
 * the v6.2.1 polish PR so they don't silently regress.
 */

import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { TeamHubHeader } from "./TeamHubHeader"
import { TeamHubMetricsGrid } from "./TeamHubMetricsGrid"
import { TeamHubActiveReposCard } from "./TeamHubActiveReposCard"
import { TeamHubAIReportsCard } from "./TeamHubAIReportsCard"
import type { Team } from "../../../lib/gnoloveConstants"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

const team: Team = {
    slug: "onbloc",
    name: "Onbloc",
    color: "purple",
    description: "Testing team",
    members: ["notjoon", "r3v4s"],
}

function withQueryClient(children: React.ReactNode) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

describe("TeamHubHeader period tablist (P1 — Plan §7)", () => {
    it("renders a tablist labelled by the 'Period' span", () => {
        render(
            <MemoryRouter>
                <TeamHubHeader
                    team={team}
                    period="monthly"
                    onPeriodChange={() => {}}
                    lastSyncedAt="2026-05-19T10:00:00Z"
                    networkKey="gnoland1"
                    backToTeamsHref="/gnoland1/gnolove/teams"
                />
            </MemoryRouter>,
        )
        const tablist = screen.getByRole("tablist")
        expect(tablist).toBeInTheDocument()
        // aria-labelledby points at the visible "Period" label.
        const labelledById = tablist.getAttribute("aria-labelledby")
        expect(labelledById).toBeTruthy()
        const label = document.getElementById(labelledById!)
        expect(label?.textContent).toMatch(/period/i)
    })

    it("marks the active period with aria-current=page and aria-selected", () => {
        render(
            <MemoryRouter>
                <TeamHubHeader
                    team={team}
                    period="monthly"
                    onPeriodChange={() => {}}
                    lastSyncedAt={null}
                    networkKey="gnoland1"
                    backToTeamsHref="/gnoland1/gnolove/teams"
                />
            </MemoryRouter>,
        )
        const tabs = screen.getAllByRole("tab")
        const active = tabs.find(t => t.getAttribute("aria-current") === "page")
        expect(active).toBeDefined()
        expect(active?.getAttribute("aria-selected")).toBe("true")
        // Only one active tab at a time.
        const allActive = tabs.filter(t => t.getAttribute("aria-current") === "page")
        expect(allActive).toHaveLength(1)
    })
})

describe("TeamHubMetricsGrid (P2 — aria-live)", () => {
    it("wraps the metric grid in an aria-live=polite region", () => {
        render(
            <TeamHubMetricsGrid
                stats={{
                    schemaVersion: 1,
                    lastSyncedAt: null,
                    slug: "onbloc",
                    period: "monthly",
                    repos: [],
                    stats: [],
                    totals: { mergedPRs: 12, activeContributors: 3, activeRepos: 2 },
                }}
                isLoading={false}
                teamMemberCount={9}
            />,
        )
        const live = screen.getByLabelText("Team metrics")
        expect(live.getAttribute("aria-live")).toBe("polite")
    })
})

describe("Skeleton fidelity (P1 — Plan §7)", () => {
    it("ActiveReposCard skeleton marks aria-busy and shaped rows", () => {
        const { container } = render(
            <TeamHubActiveReposCard data={undefined} isLoading={true} />,
        )
        const card = container.querySelector(".gl-thub-card")
        expect(card?.getAttribute("aria-busy")).toBe("true")
        // 4 repo-row skeletons (matches the loaded layout's typical density).
        const skelRows = container.querySelectorAll(".gl-thub-active-repo-skel")
        expect(skelRows.length).toBe(4)
        // Each row has both a name-shape and a count-shape skeleton.
        const firstRow = skelRows[0]
        expect(firstRow.querySelector(".gl-thub-skel-repo-name")).toBeInTheDocument()
        expect(firstRow.querySelector(".gl-thub-skel-repo-count")).toBeInTheDocument()
    })

    it("AIReportsCard skeleton uses the report-shaped template, not generic lines", () => {
        const { container } = render(withQueryClient(<TeamHubAIReportsCard team={team} />))
        const card = container.querySelector(".gl-thub-card")
        expect(card?.getAttribute("aria-busy")).toBe("true")
        expect(container.querySelector(".gl-thub-skel-airpt")).toBeInTheDocument()
        // Two summary lines + one toggle bar.
        expect(container.querySelectorAll(".gl-thub-skel-airpt-summary").length).toBe(2)
        expect(container.querySelector(".gl-thub-skel-airpt-toggle")).toBeInTheDocument()
    })
})
