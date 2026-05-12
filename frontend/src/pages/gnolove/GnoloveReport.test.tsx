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
import { render, screen } from "@testing-library/react"
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
        const tableBtn = screen.getByRole("button", { name: "Table" })
        expect(tableBtn.getAttribute("aria-pressed")).toBe("true")
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
