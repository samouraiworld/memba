import { describe, it, expect } from "vitest"
import { render, screen, within, fireEvent } from "@testing-library/react"
import { ValidatorScoreCard } from "./ValidatorScoreCard"
import type { ReportWindow, ValidatorReport, ValidatorReportPeriod } from "../../lib/validatorReports"

// Shapes taken from the live gnoland-1 report on 2026-09-13. The chain was a
// day old, so every window carried the SAME sign rate, misses and incidents —
// only the score moved (24 → 68), because the score penalises incidents per
// WEEK and a shorter window makes the same 27 incidents look more frequent.
// That is exactly why a score is never shown without what drives it.
function period(over: Partial<ValidatorReportPeriod> = {}): ValidatorReportPeriod {
    return {
        score: 24,
        tier: "Critical",
        signRate: 98.60705073086844,
        proposerReliability: 98.15993121238176,
        votingPower: 60,
        criticalCount: 0,
        warningCount: 27,
        incidentCount: 27,
        incidentRatePerWeek: 189,
        downtimeBlocks: 0,
        missedBlocks: 243,
        hasData: true,
        ...over,
    }
}

const NO_DATA = period({
    score: 0, tier: "Critical", signRate: 0, proposerReliability: null, criticalCount: 0,
    warningCount: 0, incidentCount: 0, incidentRatePerWeek: 0, downtimeBlocks: 0, missedBlocks: 0,
    hasData: false,
})

function report(periods: Partial<Record<ReportWindow, ValidatorReportPeriod | null>>, over: Partial<ValidatorReport> = {}): ValidatorReport {
    const full = {
        last_24h: null, current_week: null, current_month: null, current_year: null,
        ...periods,
    } as Record<ReportWindow, ValidatorReportPeriod | null>
    return {
        addr: "g15t7f9q6km3example",
        moniker: "samourai-crew-validator-1",
        daysSinceLastAlert: 0,
        periods: full,
        hasData: Object.values(full).some((p) => p?.hasData === true),
        ...over,
    }
}

const ADDR = "g15t7f9q6km3example"

const SAMOURAI = report({
    last_24h: period(),
    current_week: period({ score: 50, tier: "Watch", incidentRatePerWeek: 29.09621235709074 }),
    current_month: period({ score: 59, tier: "Watch", incidentRatePerWeek: 15.125213431446815 }),
    current_year: period({ score: 68, tier: "Good", incidentRatePerWeek: 0.7397384999775402 }),
})

function renderCard(reports: Map<string, ValidatorReport> | null | undefined, { address = ADDR, loading = false } = {}) {
    return render(<ValidatorScoreCard address={address} reports={reports} loading={loading} />)
}

const panel = () => screen.getByRole("tabpanel")

describe("ValidatorScoreCard — states that carry no score", () => {
    it("says it is loading while the report is on its way", () => {
        renderCard(undefined, { loading: true })
        expect(screen.getByTestId("vd-score")).toHaveTextContent("Loading score…")
        expect(screen.queryByRole("tab")).not.toBeInTheDocument()
    })

    it("says the score is unavailable when monitoring could not be asked, never an empty verdict", () => {
        renderCard(null)
        expect(screen.getByTestId("vd-score")).toHaveTextContent("Score unavailable right now.")
        expect(screen.queryByRole("tab")).not.toBeInTheDocument()
    })

    it("treats a failed load that produced no data like an outage, not like a missing validator", () => {
        renderCard(undefined, { loading: false })
        expect(screen.getByTestId("vd-score")).toHaveTextContent("Score unavailable right now.")
    })

    it("says not scored yet when monitoring has no report for this address", () => {
        renderCard(new Map([["g1someoneelse", SAMOURAI]]))
        expect(screen.getByTestId("vd-score")).toHaveTextContent("Not scored yet")
        expect(screen.queryByRole("tab")).not.toBeInTheDocument()
    })

    it("never turns a zero-valued (no evidence) report into a score of 0 or a Critical tier", () => {
        const empty = report({ last_24h: NO_DATA, current_week: NO_DATA, current_month: NO_DATA, current_year: NO_DATA })
        renderCard(new Map([[ADDR, empty]]))
        const card = screen.getByTestId("vd-score")
        expect(card).toHaveTextContent("Not scored yet")
        expect(card).not.toHaveTextContent("Critical")
        expect(card.textContent).not.toMatch(/\d/)
    })
})

describe("ValidatorScoreCard — a scored validator", () => {
    it("offers all four windows, each tab naming its score and tier", () => {
        renderCard(new Map([[ADDR, SAMOURAI]]))
        const tabs = screen.getAllByRole("tab")
        expect(tabs.map((t) => t.getAttribute("aria-label"))).toEqual([
            "Last 24 hours: 24 out of 100, Critical",
            "This week: 50 out of 100, Watch",
            "This month: 59 out of 100, Watch",
            "This year: 68 out of 100, Good",
        ])
    })

    it("matches the address case-insensitively, as the report map is keyed lowercase", () => {
        renderCard(new Map([[ADDR, SAMOURAI]]), { address: ADDR.toUpperCase().replace(/^G1/, "g1") })
        expect(screen.getAllByRole("tab")).toHaveLength(4)
    })

    it("opens on the last 24 hours and shows what drives that score beside it", () => {
        renderCard(new Map([[ADDR, SAMOURAI]]))
        expect(screen.getByRole("tab", { name: /Last 24 hours/ })).toHaveAttribute("aria-selected", "true")
        const p = within(panel())
        expect(p.getByText("Sign rate").nextElementSibling).toHaveTextContent("98.6%")
        expect(p.getByText("Missed blocks").nextElementSibling).toHaveTextContent("243")
        expect(p.getByText("Downtime").nextElementSibling).toHaveTextContent("0 blocks")
        expect(p.getByText("Incidents").nextElementSibling).toHaveTextContent("27 · 189/week")
        expect(p.getByText("Alerts").nextElementSibling).toHaveTextContent("0 critical · 27 warnings")
        expect(p.getByText("Proposals").nextElementSibling).toHaveTextContent("98.2% of expected")
    })

    it("switching window shows that window's own incident rate — the reason its score differs", () => {
        renderCard(new Map([[ADDR, SAMOURAI]]))
        fireEvent.click(screen.getByRole("tab", { name: /This year/ }))
        expect(screen.getByRole("tab", { name: /This year/ })).toHaveAttribute("aria-selected", "true")
        expect(screen.getByRole("tab", { name: /Last 24 hours/ })).toHaveAttribute("aria-selected", "false")
        expect(within(panel()).getByText("Incidents").nextElementSibling).toHaveTextContent("27 · 0.7/week")
        expect(panel()).toHaveAttribute("aria-labelledby", screen.getByRole("tab", { name: /This year/ }).id)
    })

    it("moves between windows with the arrow keys (APG tabs contract)", () => {
        renderCard(new Map([[ADDR, SAMOURAI]]))
        fireEvent.keyDown(screen.getByRole("tab", { name: /Last 24 hours/ }), { key: "ArrowRight" })
        expect(screen.getByRole("tab", { name: /This week/ })).toHaveAttribute("aria-selected", "true")
        expect(screen.getByRole("tab", { name: /This week/ })).toHaveAttribute("tabindex", "0")
        expect(screen.getByRole("tab", { name: /Last 24 hours/ })).toHaveAttribute("tabindex", "-1")
    })

    it("a window without evidence reads 'No data' — on its tab and in its panel — never 0 or Critical", () => {
        const r = report({ last_24h: period(), current_week: NO_DATA, current_month: null, current_year: period({ score: 68, tier: "Good" }) })
        renderCard(new Map([[ADDR, r]]))
        const week = screen.getByRole("tab", { name: /This week/ })
        expect(week).toHaveAttribute("aria-label", "This week: no data")
        expect(week).not.toHaveTextContent("Critical")
        // No digit at all — not /\b0\b/, which cannot match inside "Week0No data"
        // (no word boundary between letters and a digit) and so passed a tab
        // that rendered the raw upstream 0.
        expect(week.textContent).not.toMatch(/\d/)
        const month = screen.getByRole("tab", { name: /This month/ })
        expect(month).toHaveAttribute("aria-label", "This month: no data")
        expect(month.textContent).not.toMatch(/\d/)

        fireEvent.click(week)
        expect(panel()).toHaveTextContent("not a score of zero")
        expect(within(panel()).queryByText("Sign rate")).not.toBeInTheDocument()
    })

    it("opens on the first window that has data when the last 24 hours has none", () => {
        const r = report({ last_24h: NO_DATA, current_week: period({ score: 50, tier: "Watch" }), current_month: period(), current_year: period() })
        renderCard(new Map([[ADDR, r]]))
        expect(screen.getByRole("tab", { name: /This week/ })).toHaveAttribute("aria-selected", "true")
    })

    it("leaves out proposer reliability when the validator proposes too rarely to judge", () => {
        renderCard(new Map([[ADDR, report({ last_24h: period({ proposerReliability: null }) })]]))
        expect(within(panel()).queryByText("Proposals")).not.toBeInTheDocument()
    })

    it("pluralises single counts", () => {
        const r = report({ last_24h: period({ downtimeBlocks: 1, warningCount: 1, criticalCount: 1, incidentCount: 0, incidentRatePerWeek: 0 }) })
        renderCard(new Map([[ADDR, r]]))
        const p = within(panel())
        expect(p.getByText("Downtime").nextElementSibling).toHaveTextContent(/^1 block$/)
        expect(p.getByText("Alerts").nextElementSibling).toHaveTextContent("1 critical · 1 warning")
        // Zero incidents carry no rate — "0 · 0/week" is noise.
        expect(p.getByText("Incidents").nextElementSibling).toHaveTextContent(/^0$/)
    })

    it("marks tiers with a tone class but always spells the tier out (colour is never the only signal)", () => {
        const r = report({
            last_24h: period({ score: 24, tier: "Critical" }),
            current_week: period({ score: 50, tier: "Watch" }),
            current_month: period({ score: 77, tier: "Good" }),
            current_year: period({ score: 91, tier: "Surprising" }),
        })
        renderCard(new Map([[ADDR, r]]))
        const [day, week, month, year] = screen.getAllByRole("tab")
        expect(day).toHaveClass("vd-score-tab--bad")
        expect(day).toHaveTextContent("Critical")
        expect(week).toHaveClass("vd-score-tab--warn")
        expect(month).toHaveClass("vd-score-tab--ok")
        // An unknown upstream tier is shown verbatim, untoned.
        expect(year).toHaveTextContent("Surprising")
        expect(year.className).not.toMatch(/vd-score-tab--(ok|warn|bad)/)
    })

    it("explains how the score is built and where the tier lines are", () => {
        renderCard(new Map([[ADDR, SAMOURAI]]))
        const card = screen.getByTestId("vd-score")
        expect(card).toHaveTextContent("sign rate")
        expect(card).toHaveTextContent("Excellent 85+ · Good 60+ · Watch 30+ · Critical below 30")
    })

    it("says when the last alert fired, and says nothing when upstream doesn't know", () => {
        const today = renderCard(new Map([[ADDR, SAMOURAI]]))
        expect(screen.getByTestId("vd-score")).toHaveTextContent("Last alert today")
        today.unmount()

        const days = renderCard(new Map([[ADDR, { ...SAMOURAI, daysSinceLastAlert: 3 }]]))
        expect(screen.getByTestId("vd-score")).toHaveTextContent("Last alert 3 days ago")
        days.unmount()

        const one = renderCard(new Map([[ADDR, { ...SAMOURAI, daysSinceLastAlert: 1 }]]))
        expect(screen.getByTestId("vd-score")).toHaveTextContent("Last alert 1 day ago")
        one.unmount()

        renderCard(new Map([[ADDR, { ...SAMOURAI, daysSinceLastAlert: null }]]))
        expect(screen.getByTestId("vd-score")).not.toHaveTextContent("Last alert")
    })
})
