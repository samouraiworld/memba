import { describe, it, expect, vi, beforeEach } from "vitest"
import { render as rtlRender, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactElement } from "react"
import { WindowActivityContext } from "../../os/page/WindowActivity"

// Fresh client per render: retry off and zero cache sharing between tests.
function render(ui: ReactElement) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return rtlRender(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

const { getValidators, TEST_SNAPSHOT } = vi.hoisted(() => ({
    getValidators: vi.fn(() => Promise.resolve([])),
    TEST_SNAPSHOT: { url: "https://verified.example", chainId: "gnoland-1", height: 100, blockHash: "abc", status: {} },
}))

vi.mock("../../lib/validators", () => ({
    getValidators,
    getValidatorRpcSnapshot: vi.fn(() => Promise.resolve(TEST_SNAPSHOT)),
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
import { fetchLastBlockSignatures, getNetworkStats } from "../../lib/validators"
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

    it("an active validator triggers the (lazy) metrics fetch on one snapshot", async () => {
        render(<ValidatorPerformancePanel signingAddress="g1sign" isActive={true} />)
        await waitFor(() => expect(getValidators).toHaveBeenCalledTimes(1))
        expect(getValidators).toHaveBeenCalledWith(expect.any(String), TEST_SNAPSHOT, expect.any(AbortSignal))
        expect(fetchLastBlockSignatures).toHaveBeenCalledWith(expect.any(String), 100, 10, TEST_SNAPSHOT, expect.any(AbortSignal))
        await waitFor(() => expect(getNetworkStats).toHaveBeenCalledWith(expect.any(String), [], expect.any(AbortSignal), TEST_SNAPSHOT))
    })

    it("does not start performance or report reads in a parked OS window", async () => {
        render(<WindowActivityContext.Provider value={false}>
            <ValidatorPerformancePanel signingAddress="g1sign" isActive />
        </WindowActivityContext.Provider>)
        await Promise.resolve()
        expect(getValidators).not.toHaveBeenCalled()
        expect(fetchValidatorReports).not.toHaveBeenCalled()
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
