import { describe, it, expect, vi, beforeEach } from "vitest"
import { render as rtlRender, screen } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactElement } from "react"

// Fresh client per render: retry off and zero cache sharing between tests.
function render(ui: ReactElement) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return rtlRender(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

const { getValidators } = vi.hoisted(() => ({ getValidators: vi.fn(() => Promise.resolve([])) }))

vi.mock("../../lib/validators", () => ({
    getValidators,
    getNetworkStats: vi.fn(() => Promise.resolve({ blockHeight: 1, totalValidators: 0 })),
    fetchBlockHeatmap: vi.fn(() => Promise.resolve([])),
    fetchLastBlockSignatures: vi.fn(() => Promise.resolve(new Map())),
    mergeWithMonitoringData: vi.fn((v: unknown) => v),
    formatVotingPower: (n: number) => String(n),
    formatRelativeTime: () => "—",
}))
vi.mock("../../lib/gnomonitoring", () => ({ fetchAllMonitoringData: vi.fn(() => Promise.resolve(new Map())) }))
vi.mock("../../lib/validatorHealth", () => ({
    computeHealthStatus: () => ({ status: "ok" }),
    healthCssClass: () => "", healthLabel: () => "OK", healthIcon: () => "●",
}))
vi.mock("./BlockHeatmap", () => ({ BlockHeatmap: () => <div data-testid="heatmap" /> }))

const { fetchValidatorReports } = vi.hoisted(() => ({ fetchValidatorReports: vi.fn() }))
vi.mock("../../lib/validatorReports", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../lib/validatorReports")>()),
    fetchValidatorReports,
}))

import { ValidatorPerformancePanel } from "./ValidatorPerformancePanel"
import type { ValidatorReport, ValidatorReportPeriod } from "../../lib/validatorReports"

const period: ValidatorReportPeriod = {
    score: 91, tier: "Excellent", signRate: 99.5, proposerReliability: 100, votingPower: 60,
    criticalCount: 0, warningCount: 0, incidentCount: 0, incidentRatePerWeek: 0,
    downtimeBlocks: 0, missedBlocks: 3, hasData: true,
}
const scoredReport: ValidatorReport = {
    addr: "g1sign", moniker: "v", daysSinceLastAlert: null, hasData: true,
    periods: { last_24h: period, current_week: period, current_month: period, current_year: period },
}

describe("ValidatorPerformancePanel", () => {
    beforeEach(() => {
        getValidators.mockReset()
        getValidators.mockImplementation(() => Promise.resolve([]))
        fetchValidatorReports.mockReset()
        fetchValidatorReports.mockResolvedValue(null)
    })

    it("a candidate (isActive=false) shows the honest explainer and fetches nothing", () => {
        render(<ValidatorPerformancePanel signingAddress="g1sign" isActive={false} />)
        expect(screen.getByTestId("vp-perf-inactive")).toBeInTheDocument()
        expect(getValidators).not.toHaveBeenCalled()
        expect(fetchValidatorReports).not.toHaveBeenCalled()
    })

    it("an active validator triggers the (lazy) metrics fetch", () => {
        render(<ValidatorPerformancePanel signingAddress="g1sign" isActive={true} />)
        expect(getValidators).toHaveBeenCalledTimes(1)
    })

    it("shows the validator's reliability score beside its live metrics", async () => {
        getValidators.mockImplementation(() => Promise.resolve([
            { address: "ABCDEF", gnoAddr: "g1sign", votingPower: 60, powerPercent: 25, proposerPriority: 0, startTime: null },
        ] as never))
        fetchValidatorReports.mockResolvedValue(new Map([["g1sign", scoredReport]]))
        render(<ValidatorPerformancePanel signingAddress="g1sign" isActive={true} />)
        expect(await screen.findByRole("tab", { name: "Last 24 hours: 91 out of 100, Excellent" })).toBeInTheDocument()
        expect(screen.getByTestId("vp-perf-metrics")).toContainElement(screen.getByTestId("vd-score"))
    })
})
