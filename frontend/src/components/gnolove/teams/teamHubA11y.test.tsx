/**
 * Smoke tests for the Phase-7 / v6.2.1 UX polish:
 * - period selector uses the tablist pattern from GnoloveReport
 * - cards expose aria-live regions so screen readers announce period changes
 * - loading states set aria-busy and shape-fidelity skeleton markup
 *
 * Not exhaustive — just locks the explicitly-shipped a11y promises in
 * the v6.2.1 polish PR so they don't silently regress.
 */

import { useState } from "react"
import { describe, it, expect } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { MemoryRouter, Routes, Route } from "react-router-dom"
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

    // The APG keyboard contract itself is covered in
    // hooks/useTabListKeyboard.test.tsx; these pin that the period selector is
    // wired through the hook — the roving tabindex only exists if tabProps is
    // spread, and arrow-selection only works if onSelect reaches onPeriodChange.
    it("gives the periods a roving tabindex (single tab stop)", () => {
        render(
            <MemoryRouter>
                <TeamHubHeader
                    team={team}
                    period="monthly"
                    onPeriodChange={() => {}}
                    lastSyncedAt={null}
                    backToTeamsHref="/gnoland1/gnolove/teams"
                />
            </MemoryRouter>,
        )
        const tabs = screen.getAllByRole("tab")
        expect(tabs.filter(t => t.getAttribute("tabindex") === "0")).toHaveLength(1)
        expect(screen.getByRole("tab", { name: /month/i })).toHaveAttribute("tabindex", "0")
    })

    it("ArrowRight moves selection to the next period", () => {
        function Harness() {
            const [period, setPeriod] = useState<"monthly" | "weekly">("monthly")
            return (
                <MemoryRouter>
                    <TeamHubHeader
                        team={team}
                        period={period}
                        onPeriodChange={(p) => setPeriod(p as "monthly" | "weekly")}
                        lastSyncedAt={null}
                        backToTeamsHref="/gnoland1/gnolove/teams"
                    />
                </MemoryRouter>
            )
        }
        render(<Harness />)
        // TEAM_HUB_PERIODS order: all, yearly, monthly, weekly, daily.
        fireEvent.keyDown(screen.getByRole("tab", { name: /month/i }), { key: "ArrowRight" })
        const week = screen.getByRole("tab", { name: /week/i })
        expect(week).toHaveAttribute("aria-selected", "true")
        expect(week).toHaveAttribute("tabindex", "0")
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
        expect(screen.getByLabelText("Team metrics")).toBeInTheDocument()
        const liveRegion = screen.getByText(/12 merged PRs, 3 active contributors/)
        expect(liveRegion.getAttribute("aria-live")).toBe("polite")
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
        const { container } = render(<MemoryRouter>{withQueryClient(<TeamHubAIReportsCard team={team} />)}</MemoryRouter>)
        const card = container.querySelector(".gl-thub-card")
        expect(card?.getAttribute("aria-busy")).toBe("true")
        expect(container.querySelector(".gl-thub-skel-airpt")).toBeInTheDocument()
        // Two summary lines + one toggle bar.
        expect(container.querySelectorAll(".gl-thub-skel-airpt-summary").length).toBe(2)
        expect(container.querySelector(".gl-thub-skel-airpt-toggle")).toBeInTheDocument()
    })
})

describe('TeamHubHeader "Data: mainnet" disclosure', () => {
    // The chip was gated on `useNetworkKey() === "test13"`, so the topaz cutover
    // silently dropped the disclosure. It now keys off NETWORKS[...].isTestnet,
    // which covers topaz. The rule it must NOT break: gnolove-team-hub e2e
    // asserts the chip is ABSENT on gnoland1 ("real chain") — see the third case.
    it("renders on topaz, the network the test13 literal missed", () => {
        render(
            <MemoryRouter>
                <TeamHubHeader
                    team={team}
                    period="monthly"
                    onPeriodChange={() => {}}
                    lastSyncedAt="2026-05-19T10:00:00Z"
                    backToTeamsHref="/gnoland1/gnolove/teams"
                />
            </MemoryRouter>,
        )
        expect(screen.getByText("Data: mainnet")).toBeInTheDocument()
    })

    // A bare <MemoryRouter initialEntries={["/test13/..."]}> does NOT bind a
    // :network param — with no matching <Route>, useParams() returns {} and the
    // old condition read DEFAULT_NETWORK, making this indistinguishable from the
    // case above. The <Routes> wrapper is what actually puts "test13" in params.
    // Control: passes on the OLD code too (params bind test13, so the old literal
    // matched). Kept to prove the fix did not regress the case that already worked.
    it("still renders on a real test13 deep link (control)", () => {
        render(
            <MemoryRouter initialEntries={["/test13/gnolove/teams/onbloc"]}>
                <Routes>
                    <Route
                        path="/:network/gnolove/teams/:slug"
                        element={
                            <TeamHubHeader
                                team={team}
                                period="monthly"
                                onPeriodChange={() => {}}
                                lastSyncedAt="2026-05-19T10:00:00Z"
                                backToTeamsHref="/test13/gnolove/teams"
                            />
                        }
                    />
                </Routes>
            </MemoryRouter>,
        )
        expect(screen.getByText("Data: mainnet")).toBeInTheDocument()
    })
})

describe('TeamHubHeader chip stays hidden on a real chain', () => {
    // gnolove-team-hub.spec.ts asserts `.gl-thub-chip-network` has count 0 on
    // gnoland1. An unconditional chip would break that e2e — this is the unit
    // guard so the contradiction is caught in seconds, not in a browser run.
    it("does NOT render on gnoland1", () => {
        render(
            <MemoryRouter initialEntries={["/gnoland1/gnolove/teams/onbloc"]}>
                <Routes>
                    <Route
                        path="/:network/gnolove/teams/:slug"
                        element={
                            <TeamHubHeader
                                team={team}
                                period="monthly"
                                onPeriodChange={() => {}}
                                lastSyncedAt="2026-05-19T10:00:00Z"
                                backToTeamsHref="/gnoland1/gnolove/teams"
                            />
                        }
                    />
                </Routes>
            </MemoryRouter>,
        )
        expect(screen.queryByText("Data: mainnet")).not.toBeInTheDocument()
    })
})
