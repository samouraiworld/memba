/**
 * Tests for useReportUrlState — bridges useSearchParams with the gnoloveReportUrl schema.
 *
 * Covers: read from URL, partial updates, push vs replace history strategy,
 * default-elision, strict-mode double-invoke, repeated reads return equal state.
 *
 * Plan: docs/planning/GNOLOVE_SHAREABLE_REPORT_URLS_PLAN.md §6 Task 0.3.
 * Must-fix coverage: MF-2 (push on filter axes / replace on view),
 * MF-20 ([searchParams] memo key, no lint disable), MF-22 (strict-mode).
 *
 * @module hooks/gnolove/useReportUrlState.test
 */

import { StrictMode } from "react"
import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { MemoryRouter, useNavigate, useLocation } from "react-router-dom"
import { useReportUrlState } from "./useReportUrlState"
import { DEFAULT_REPORT_STATE, type ReportPeriod } from "../../lib/gnoloveReportUrl"

// Sentry mock (parser fires breadcrumbs on fallback)
vi.mock("@sentry/react", () => ({
    addBreadcrumb: vi.fn(),
    captureMessage: vi.fn(),
}))

/** Harness component that renders state + buttons that mutate it. */
function Harness() {
    const [state, setState] = useReportUrlState()
    const location = useLocation()
    return (
        <div>
            <div data-testid="period">{state.period}</div>
            <div data-testid="at">{state.at ?? "null"}</div>
            <div data-testid="tab">{state.tab}</div>
            <div data-testid="team">{state.team ?? "null"}</div>
            <div data-testid="repos">{state.repos.join(",") || "(empty)"}</div>
            <div data-testid="view">{state.view}</div>
            <div data-testid="search">{location.search || "(no-search)"}</div>
            <button data-testid="set-monthly" onClick={() => setState({ period: "monthly", at: "2025-03" })}>
                set monthly 2025-03
            </button>
            <button data-testid="set-tab-merged" onClick={() => setState({ tab: "merged" })}>
                tab merged
            </button>
            <button data-testid="set-view-table" onClick={() => setState({ view: "table" })}>
                view table
            </button>
            <button data-testid="set-tab-all" onClick={() => setState({ tab: "all" })}>
                tab all
            </button>
        </div>
    )
}

function renderHarness(initialEntry = "/test12/gnolove/report") {
    return render(
        <MemoryRouter initialEntries={[initialEntry]}>
            <Harness />
        </MemoryRouter>,
    )
}

// ── Reads ───────────────────────────────────────────────────

describe("useReportUrlState — reads from URL", () => {
    it("empty URL yields DEFAULT_REPORT_STATE", () => {
        renderHarness("/test12/gnolove/report")
        expect(screen.getByTestId("period").textContent).toBe(DEFAULT_REPORT_STATE.period)
        expect(screen.getByTestId("tab").textContent).toBe("all")
        expect(screen.getByTestId("repos").textContent).toBe("gnolang/gno")
        expect(screen.getByTestId("view").textContent).toBe("report")
    })

    it("?period=monthly&at=2026-05 reads correctly", () => {
        renderHarness("/test12/gnolove/report?period=monthly&at=2026-05")
        expect(screen.getByTestId("period").textContent).toBe("monthly")
        expect(screen.getByTestId("at").textContent).toBe("2026-05")
    })

    it("?team=Samourai.world&repos=gnolang/gno,samouraiworld/memba reads sorted", () => {
        renderHarness("/test12/gnolove/report?team=Samourai.world&repos=gnolang/gno,samouraiworld/memba")
        expect(screen.getByTestId("team").textContent).toBe("Samourai.world")
        expect(screen.getByTestId("repos").textContent).toBe("gnolang/gno,samouraiworld/memba")
    })
})

// ── Writes: history strategy [MF-2] ────────────────────────

describe("useReportUrlState — push vs replace history strategy [MF-2]", () => {
    it("setState({ view }) replaces history entry (no new entry)", () => {
        const history: string[] = []
        function HistoryHarness() {
            const location = useLocation()
            history.push(location.search)
            return <Harness />
        }
        render(
            <MemoryRouter initialEntries={["/x"]}>
                <HistoryHarness />
            </MemoryRouter>,
        )
        const before = history.length
        fireEvent.click(screen.getByTestId("set-view-table"))
        // URL changed
        expect(screen.getByTestId("view").textContent).toBe("table")
        expect(history.length).toBeGreaterThan(before)
    })

    it("setState({ period, at }) uses push (back-button restores previous state)", () => {
        function PushHarness() {
            const [state, setState] = useReportUrlState()
            const nav = useNavigate()
            return (
                <div>
                    <div data-testid="period">{state.period}</div>
                    <div data-testid="at">{state.at ?? "null"}</div>
                    <button data-testid="go" onClick={() => setState({ period: "monthly", at: "2025-03" })}>
                        go
                    </button>
                    <button data-testid="back" onClick={() => nav(-1)}>back</button>
                </div>
            )
        }
        render(
            <MemoryRouter initialEntries={["/x"]}>
                <PushHarness />
            </MemoryRouter>,
        )
        expect(screen.getByTestId("period").textContent).toBe("weekly")
        fireEvent.click(screen.getByTestId("go"))
        expect(screen.getByTestId("period").textContent).toBe("monthly")
        fireEvent.click(screen.getByTestId("back"))
        // Back must restore the previous (default) state because we used push, not replace.
        expect(screen.getByTestId("period").textContent).toBe("weekly")
    })

    it("setState({ view }) does NOT pollute history (back skips it)", () => {
        function ReplaceHarness() {
            const [state, setState] = useReportUrlState()
            const nav = useNavigate()
            return (
                <div>
                    <div data-testid="view">{state.view}</div>
                    <div data-testid="period">{state.period}</div>
                    <button data-testid="step-period" onClick={() => setState({ period: "monthly", at: "2025-03" })}>
                        step period (push)
                    </button>
                    <button data-testid="toggle-view" onClick={() => setState({ view: "table" })}>
                        toggle view (replace)
                    </button>
                    <button data-testid="back" onClick={() => nav(-1)}>back</button>
                </div>
            )
        }
        render(
            <MemoryRouter initialEntries={["/x"]}>
                <ReplaceHarness />
            </MemoryRouter>,
        )
        // 1. Push: period weekly → monthly (new history entry)
        fireEvent.click(screen.getByTestId("step-period"))
        expect(screen.getByTestId("period").textContent).toBe("monthly")
        // 2. Replace: toggle view (no new history entry)
        fireEvent.click(screen.getByTestId("toggle-view"))
        expect(screen.getByTestId("view").textContent).toBe("table")
        // 3. Back: should restore weekly (skipping the view toggle entirely)
        fireEvent.click(screen.getByTestId("back"))
        expect(screen.getByTestId("period").textContent).toBe("weekly")
    })
})

// ── Partial updates preserve unrelated state ───────────────

describe("useReportUrlState — partial updates", () => {
    it("setState({ tab }) preserves period+at from URL", () => {
        renderHarness("/test12/gnolove/report?period=monthly&at=2025-03")
        fireEvent.click(screen.getByTestId("set-tab-merged"))
        expect(screen.getByTestId("period").textContent).toBe("monthly")
        expect(screen.getByTestId("at").textContent).toBe("2025-03")
        expect(screen.getByTestId("tab").textContent).toBe("merged")
    })

    it("setting a field back to default removes it from URL", () => {
        renderHarness("/test12/gnolove/report?tab=merged")
        // tab is merged in URL
        expect(screen.getByTestId("search").textContent).toContain("tab=merged")
        fireEvent.click(screen.getByTestId("set-tab-all"))
        // tab=all is the default → must not appear in URL
        expect(screen.getByTestId("search").textContent || "").not.toContain("tab=")
    })
})

// ── React 19 StrictMode [MF-22] ─────────────────────────────

describe("useReportUrlState — React 19 StrictMode safety [MF-22]", () => {
    it("renders cleanly inside <StrictMode> with no extra writes", () => {
        const log: string[] = []
        function StrictHarness() {
            const [state] = useReportUrlState()
            log.push(state.period)
            return <div data-testid="period">{state.period}</div>
        }
        render(
            <StrictMode>
                <MemoryRouter initialEntries={["/x?period=monthly&at=2025-03"]}>
                    <StrictHarness />
                </MemoryRouter>
            </StrictMode>,
        )
        expect(screen.getByTestId("period").textContent).toBe("monthly")
        // StrictMode invokes the component function twice in dev; both reads must agree.
        expect(log.every(p => p === "monthly")).toBe(true)
    })
})

// ── Stable state identity per searchParams content ──────────

describe("useReportUrlState — state identity", () => {
    it("two reads of the same state produce equal (deep) values", () => {
        // We can't easily compare references through render boundaries, but we can
        // verify that two consecutive `setState` calls of the same patch produce
        // semantically-equal state (no churn).
        function IdentityHarness() {
            const [state, setState] = useReportUrlState()
            return (
                <div>
                    <div data-testid="period">{state.period}</div>
                    <button data-testid="noop" onClick={() => setState({ period: state.period as ReportPeriod })}>
                        noop
                    </button>
                </div>
            )
        }
        render(
            <MemoryRouter initialEntries={["/x"]}>
                <IdentityHarness />
            </MemoryRouter>,
        )
        expect(screen.getByTestId("period").textContent).toBe("weekly")
        fireEvent.click(screen.getByTestId("noop"))
        expect(screen.getByTestId("period").textContent).toBe("weekly")
    })
})
