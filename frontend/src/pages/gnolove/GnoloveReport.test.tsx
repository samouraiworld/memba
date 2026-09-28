/**
 * Tests for GnoloveReport — URL-state rewire + bug fixes.
 *
 * Covers:
 *   - BUG-2: stale-repo banner when URL pins a repo not in dataset
 *   - BUG-4: PR status badge derived from data, not from active tab
 *   - BUG-5: period-switch uses end of current range (containing-month)
 *   - R-12: stale-team banner when URL pins ?team=Foo where Foo ∉ TEAMS
 *   - UX-2: empty-state branches with scoped clear actions
 *
 * The render-tree is large so we test through the public render surface,
 * mocking the data hooks. BUG-3 (Highlights mergedAt sort) and BUG-6
 * (footer ID + filter URL) are covered indirectly by other tests when
 * the narrative view is rendered.
 *
 * @module pages/gnolove/GnoloveReport.test
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, within } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import GnoloveReport from "./GnoloveReport"
import { nextAtForPeriodSwitch } from "../../lib/gnoloveReportUrl"

// Mock the gnolove hooks — we don't want real network calls.
vi.mock("../../hooks/gnolove", async () => {
    const actual = await vi.importActual<typeof import("../../hooks/gnolove")>("../../hooks/gnolove")
    return {
        ...actual,
        useGnoloveReport: vi.fn(),
        useGnoloveRepositories: vi.fn(),
    }
})

// Mock Sentry to avoid noisy breadcrumb output
vi.mock("@sentry/react", () => ({
    addBreadcrumb: vi.fn(),
    captureMessage: vi.fn(),
}))

// Mock useNetworkKey since we don't have a NetworkGate wrapper
vi.mock("../../hooks/useNetworkNav", () => ({
    useNetworkKey: () => "test12",
    useNetworkNav: () => () => {},
    useNetworkPath: () => (p: string) => `/test12/${p}`,
}))

import { useGnoloveReport, useGnoloveRepositories } from "../../hooks/gnolove"

const mockedUseReport = vi.mocked(useGnoloveReport)
const mockedUseRepos = vi.mocked(useGnoloveRepositories)

type QueryShape<T> = {
    data: T | undefined
    isLoading: boolean
    isError: boolean
    refetch: () => void
}

function makeQuery<T>(data: T | undefined, isLoading = false, isError = false): QueryShape<T> {
    return { data, isLoading, isError, refetch: () => {} }
}

function renderAt(url: string) {
    return render(
        <MemoryRouter initialEntries={[url]}>
            <GnoloveReport />
        </MemoryRouter>,
    )
}

beforeEach(() => {
    mockedUseReport.mockReset()
    mockedUseRepos.mockReset()
})

// ── BUG-5 fix: nextAtForPeriodSwitch (unit) ────────────────

describe("nextAtForPeriodSwitch [BUG-5 fix / ADR-007]", () => {
    it("weekly W18 2026 → monthly lands on May (week ends 2026-05-03)", () => {
        // ISO W18 2026 = Mon 2026-04-27 → Sun 2026-05-03
        expect(nextAtForPeriodSwitch("weekly", "2026-W18", "monthly")).toBe("2026-05")
    })

    it("weekly W19 2026 → monthly stays in May", () => {
        // ISO W19 2026 = Mon 2026-05-04 → Sun 2026-05-10
        expect(nextAtForPeriodSwitch("weekly", "2026-W19", "monthly")).toBe("2026-05")
    })

    it("all_time → weekly does NOT teleport to 2010", () => {
        const next = nextAtForPeriodSwitch("all_time", null, "weekly")
        const year = next?.slice(0, 4)
        expect(Number(year)).toBeGreaterThan(2020)
    })
})

// ── BUG-2 fix: stale-repo banner ───────────────────────────

describe("GnoloveReport — stale-repo banner [BUG-2]", () => {
    it("shows warning when URL pins an unknown repository", () => {
        mockedUseReport.mockReturnValue(makeQuery({ merged: [], in_progress: [], waiting_for_review: [], reviewed: [], blocked: [] }) as never)
        mockedUseRepos.mockReturnValue(makeQuery([
            { id: 1, owner: "gnolang", name: "gno" },
        ]) as never)

        renderAt("/test12/gnolove/report?repos=gnolang/gno,bogus/repo")

        const banner = screen.queryByRole("alert")
        expect(banner).not.toBeNull()
        expect(banner!.textContent).toContain("bogus/repo")
    })

    it("does NOT show banner when all pinned repos are known", () => {
        mockedUseReport.mockReturnValue(makeQuery({ merged: [], in_progress: [], waiting_for_review: [], reviewed: [], blocked: [] }) as never)
        mockedUseRepos.mockReturnValue(makeQuery([
            { id: 1, owner: "gnolang", name: "gno" },
        ]) as never)
        renderAt("/test12/gnolove/report?repos=gnolang/gno")
        const banner = screen.queryByText(/not in the current dataset/i)
        expect(banner).toBeNull()
    })
})

// ── R-12: stale-team banner ────────────────────────────────

describe("GnoloveReport — stale-team banner [R-12 / A-15]", () => {
    it("shows banner when URL pins ?team=NotARealTeam", () => {
        mockedUseReport.mockReturnValue(makeQuery({ merged: [], in_progress: [], waiting_for_review: [], reviewed: [], blocked: [] }) as never)
        mockedUseRepos.mockReturnValue(makeQuery([]) as never)
        renderAt("/test12/gnolove/report?team=NotARealTeam")
        const banner = screen.queryByText(/doesn't exist/i)
        expect(banner).not.toBeNull()
        expect(banner!.textContent).toContain("NotARealTeam")
    })

    it("does NOT show banner when team is in TEAMS", () => {
        mockedUseReport.mockReturnValue(makeQuery({ merged: [], in_progress: [], waiting_for_review: [], reviewed: [], blocked: [] }) as never)
        mockedUseRepos.mockReturnValue(makeQuery([]) as never)
        renderAt("/test12/gnolove/report?team=Samourai.world")
        const banner = screen.queryByText(/doesn't exist/i)
        expect(banner).toBeNull()
    })
})

// ── URL-state rendering: filter values from URL ─────────────

describe("GnoloveReport — URL state drives initial render", () => {
    it("?period=monthly puts 'Monthly' tab active", () => {
        mockedUseReport.mockReturnValue(makeQuery({ merged: [], in_progress: [], waiting_for_review: [], reviewed: [], blocked: [] }) as never)
        mockedUseRepos.mockReturnValue(makeQuery([]) as never)
        renderAt("/test12/gnolove/report?period=monthly&at=2025-03")
        const active = screen.getAllByRole("tab").find(t => (t as HTMLElement).getAttribute("aria-selected") === "true" && t.textContent === "Monthly")
        expect(active).toBeTruthy()
    })

    it("?view=table shows table view", () => {
        mockedUseReport.mockReturnValue(makeQuery({ merged: [], in_progress: [], waiting_for_review: [], reviewed: [], blocked: [] }) as never)
        mockedUseRepos.mockReturnValue(makeQuery([]) as never)
        renderAt("/test12/gnolove/report?view=table")
        // The toggle sits in a role=tablist, so its buttons are role=tab with
        // aria-selected — the old aria-pressed was mixed semantics (pressed
        // buttons inside a tablist) and went away with the keyboard adoption.
        const tableBtn = screen.getByRole("tab", { name: "Table" })
        expect(tableBtn.getAttribute("aria-selected")).toBe("true")
    })
})

// ── Tablist keyboard wiring ──────────────────────────────────
//
// The APG keyboard contract itself is covered in
// hooks/useTabListKeyboard.test.tsx; these pin that each of this page's three
// tablists (view / period / status) is wired through the hook — the roving
// tabindex only exists if tabProps is spread, and arrow-selection only works if
// onSelect reaches the page's URL state.

describe("GnoloveReport — tablist keyboard (APG)", () => {
    beforeEach(() => {
        mockedUseReport.mockReturnValue(makeQuery({ merged: [], in_progress: [], waiting_for_review: [], reviewed: [], blocked: [] }) as never)
        mockedUseRepos.mockReturnValue(makeQuery([]) as never)
    })

    it("ArrowRight on the period tablist moves Weekly → Monthly", () => {
        renderAt("/test12/gnolove/report?period=weekly&at=2026-W18")
        const weekly = screen.getByRole("tab", { name: "Weekly" })
        expect(weekly).toHaveAttribute("tabindex", "0")

        fireEvent.keyDown(weekly, { key: "ArrowRight" })
        const monthly = screen.getByRole("tab", { name: "Monthly" })
        expect(monthly).toHaveAttribute("aria-selected", "true")
        expect(monthly).toHaveAttribute("tabindex", "0")
        expect(screen.getByRole("tab", { name: "Weekly" })).toHaveAttribute("tabindex", "-1")
    })

    it("ArrowRight on the view toggle moves Report → Table", () => {
        renderAt("/test12/gnolove/report")
        fireEvent.keyDown(screen.getByRole("tab", { name: "Report" }), { key: "ArrowRight" })
        expect(screen.getByRole("tab", { name: "Table" })).toHaveAttribute("aria-selected", "true")
    })

    it("ArrowRight on the status tablist moves All → Merged", () => {
        renderAt("/test12/gnolove/report")
        // Name may carry a count suffix; the label "All Time" belongs to the
        // period tablist, so anchor on the status list's aria-label instead.
        const statusList = screen.getByRole("tablist", { name: "Status filter" })
        const all = within(statusList).getByRole("tab", { name: /^All/ })
        fireEvent.keyDown(all, { key: "ArrowRight" })
        expect(within(statusList).getByRole("tab", { name: /^Merged/ })).toHaveAttribute("aria-selected", "true")
    })
})

// ── Default render ───────────────────────────────────────

describe("GnoloveReport — default state", () => {
    it("renders the page title without crashing", () => {
        mockedUseReport.mockReturnValue(makeQuery(undefined) as never)
        mockedUseRepos.mockReturnValue(makeQuery([]) as never)
        renderAt("/test12/gnolove/report")
        expect(screen.getByRole("heading", { level: 1 }).textContent).toContain("PR Report")
    })

    it("garbage URL params don't crash the page", () => {
        mockedUseReport.mockReturnValue(makeQuery(undefined) as never)
        mockedUseRepos.mockReturnValue(makeQuery([]) as never)
        renderAt("/test12/gnolove/report?period=garbage&tab=alsogarbage&at=99-99")
        expect(screen.getByRole("heading", { level: 1 }).textContent).toContain("PR Report")
    })
})

describe("GnoloveReport — report and status counts share one filter scope", () => {
    const pr = (id: string, url: string, state: string) => ({
        id, number: Number(id), title: `PR ${id}`, url, state,
        authorLogin: "moul", mergedAt: state === "MERGED" ? "2026-09-15T12:00:00Z" : null,
        createdAt: "2026-09-10T12:00:00Z", updatedAt: "2026-09-16T12:00:00Z",
    })

    beforeEach(() => {
        mockedUseRepos.mockReturnValue(makeQuery([
            { id: 1, owner: "gnolang", name: "gno" },
            { id: 2, owner: "gnolang", name: "gnoverse" },
        ]) as never)
        mockedUseReport.mockReturnValue(makeQuery({
            merged: [
                pr("1", "https://github.com/gnolang/gno/pull/1", "MERGED"),
                pr("2", "https://github.com/gnolang/gnoverse/pull/2", "MERGED"),
            ],
            in_progress: [], waiting_for_review: [], reviewed: [],
            blocked: [pr("3", "https://github.com/gnolang/gno/pull/3", "OPEN")],
        }) as never)
    })

    it("scopes tab badges and narrative stats to the selected repository", () => {
        renderAt("/test12/gnolove/report?period=all&repos=gnolang/gno")
        const tabs = screen.getByRole("tablist", { name: "Status filter" })
        expect(within(tabs).getByRole("tab", { name: "All, 2 PRs" })).toBeInTheDocument()
        expect(within(tabs).getByRole("tab", { name: "Merged, 1 PR" })).toBeInTheDocument()
        expect(within(tabs).getByRole("tab", { name: "Blocked, 1 PR" })).toBeInTheDocument()
        expect(screen.getByRole("heading", { name: "🎉 Merged (1)" })).toBeInTheDocument()
        expect(screen.getByRole("heading", { name: "🚧 Blockers (1)" })).toBeInTheDocument()
        expect(screen.queryByText("PR 2")).not.toBeInTheDocument()
    })

    it("applies the weekly activity window to status badges", () => {
        mockedUseReport.mockReturnValue(makeQuery({
            merged: [
                pr("1", "https://github.com/gnolang/gno/pull/1", "MERGED"),
                { ...pr("2", "https://github.com/gnolang/gno/pull/2", "MERGED"),
                    createdAt: "2026-08-01T12:00:00Z", updatedAt: "2026-08-02T12:00:00Z",
                    mergedAt: "2026-08-02T12:00:00Z" },
            ],
            in_progress: [], waiting_for_review: [], reviewed: [], blocked: [],
        }) as never)
        renderAt("/test12/gnolove/report?period=weekly&at=2026-W38")
        const tabs = screen.getByRole("tablist", { name: "Status filter" })
        expect(within(tabs).getByRole("tab", { name: "Merged, 1 PR" })).toBeInTheDocument()
        expect(screen.getByRole("heading", { name: "🎉 Merged (1)" })).toBeInTheDocument()
        expect(screen.queryByText("PR 2")).not.toBeInTheDocument()
    })

    it("applies the selected status to Report view and its empty-state reset", () => {
        renderAt("/test12/gnolove/report?period=all&repos=gnolang/gno&tab=merged")
        expect(screen.getByRole("heading", { name: "🎉 Merged (1)" })).toBeInTheDocument()
        expect(screen.queryByRole("heading", { name: /Blockers/ })).not.toBeInTheDocument()
        expect(screen.queryByText("PR 3")).not.toBeInTheDocument()

        fireEvent.click(screen.getByRole("tab", { name: /^In Progress/ }))
        expect(screen.getByText(/No PRs match/)).toBeInTheDocument()
        fireEvent.click(screen.getByRole("button", { name: "Show all statuses" }))
        expect(screen.getByRole("heading", { name: "🚧 Blockers (1)" })).toBeInTheDocument()
    })

    it("keeps reviewed PRs separate from the waiting queue", () => {
        mockedUseReport.mockReturnValue(makeQuery({
            merged: [], in_progress: [], blocked: [],
            waiting_for_review: [pr("4", "https://github.com/gnolang/gno/pull/4", "OPEN")],
            reviewed: [pr("5", "https://github.com/gnolang/gno/pull/5", "OPEN")],
        }) as never)
        renderAt("/test12/gnolove/report?period=all&tab=reviewed")
        expect(screen.getByRole("heading", { name: "✓ Reviewed (1)" })).toBeInTheDocument()
        expect(screen.queryByRole("heading", { name: /Waiting for Review/ })).not.toBeInTheDocument()
        expect(screen.getByRole("link", { name: "#5" })).toBeInTheDocument()
        expect(screen.queryByRole("link", { name: "#4" })).not.toBeInTheDocument()
    })

    it("labels an in-progress PR consistently in the table", () => {
        mockedUseReport.mockReturnValue(makeQuery({
            merged: [], waiting_for_review: [], reviewed: [], blocked: [],
            in_progress: [pr("6", "https://github.com/gnolang/gno/pull/6", "OPEN")],
        }) as never)
        renderAt("/test12/gnolove/report?period=all&view=table&repos=gnolang/gno")
        expect(screen.getByText("PR 6").closest(".gl-pr-row")?.querySelector(".gl-pr-state"))
            .toHaveTextContent("In Progress")
    })
})
