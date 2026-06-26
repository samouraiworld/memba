import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"

const { getValidators } = vi.hoisted(() => ({ getValidators: vi.fn(() => Promise.resolve([])) }))

vi.mock("../../lib/validators", () => ({
    getValidators,
    getNetworkStats: vi.fn(() => Promise.resolve({ blockHeight: 1, totalValidators: 0 })),
    getConsensusState: vi.fn(() => Promise.resolve(null)),
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

import { ValidatorPerformancePanel } from "./ValidatorPerformancePanel"

describe("ValidatorPerformancePanel", () => {
    beforeEach(() => getValidators.mockClear())

    it("a candidate (isActive=false) shows the honest explainer and fetches nothing", () => {
        render(<ValidatorPerformancePanel signingAddress="g1sign" isActive={false} />)
        expect(screen.getByTestId("vp-perf-inactive")).toBeInTheDocument()
        expect(getValidators).not.toHaveBeenCalled()
    })

    it("an active validator triggers the (lazy) metrics fetch", () => {
        render(<ValidatorPerformancePanel signingAddress="g1sign" isActive={true} />)
        expect(getValidators).toHaveBeenCalledTimes(1)
    })
})
