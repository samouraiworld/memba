import { act, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MemoryRouter } from "react-router-dom"
import { WindowActivityContext } from "../os/page/WindowActivity"
import ValidatorsHacker from "./ValidatorsHacker"
import { fetchMonitoringIncidents } from "../lib/gnomonitoring"

const mocks = vi.hoisted(() => ({
    getValidatorRpcSnapshot: vi.fn(),
    getNetworkStats: vi.fn(),
    getValidators: vi.fn(),
    getAggregatedNetPeers: vi.fn(),
    getNodeStatus: vi.fn(),
    fetchBlockHeatmap: vi.fn(),
    fetchChainHealth: vi.fn(),
}))

vi.mock("../lib/validators", async () => ({
    ...(await vi.importActual<typeof import("../lib/validators")>("../lib/validators")),
    getValidatorRpcSnapshot: mocks.getValidatorRpcSnapshot,
    getNetworkStats: mocks.getNetworkStats,
    getValidators: mocks.getValidators,
    getAggregatedNetPeers: mocks.getAggregatedNetPeers,
    getNodeStatus: mocks.getNodeStatus,
    fetchBlockHeatmap: mocks.fetchBlockHeatmap,
    getMempoolStatus: vi.fn().mockResolvedValue(null),
    fetchValoperMonikers: vi.fn().mockResolvedValue(new Map()),
}))
vi.mock("../lib/gnomonitoring", async () => ({
    ...(await vi.importActual<typeof import("../lib/gnomonitoring")>("../lib/gnomonitoring")),
    fetchMonitoringIncidents: vi.fn().mockResolvedValue(null),
    fetchAllMonitoringData: vi.fn().mockResolvedValue(new Map()),
}))
vi.mock("../lib/chainHealthApi", async () => ({
    ...(await vi.importActual<typeof import("../lib/chainHealthApi")>("../lib/chainHealthApi")),
    fetchChainHealth: mocks.fetchChainHealth,
}))

const stats = {
    blockHeight: 4000, avgBlockTime: 5, totalValidators: 0, totalVotingPower: 0,
    chainId: "gnoland-1", catchingUp: false, latestBlockTime: "2026-09-28T00:00:00Z",
}

function page(active: boolean) {
    return <WindowActivityContext.Provider value={active}><MemoryRouter><ValidatorsHacker /></MemoryRouter></WindowActivityContext.Provider>
}

describe("ValidatorsHacker telemetry lifecycle", () => {
    beforeEach(() => {
        vi.useFakeTimers()
        vi.clearAllMocks()
        mocks.getValidatorRpcSnapshot.mockResolvedValue({ url: "https://rpc.example", chainId: "gnoland-1", height: 4000, blockHash: "abc", status: {} })
        mocks.getNetworkStats.mockResolvedValue(stats)
        mocks.getValidators.mockResolvedValue([])
        mocks.getAggregatedNetPeers.mockResolvedValue(null)
        mocks.getNodeStatus.mockResolvedValue(null)
        mocks.fetchBlockHeatmap.mockResolvedValue([])
        mocks.fetchChainHealth.mockResolvedValue(null)
        vi.mocked(fetchMonitoringIncidents).mockReset()
        vi.mocked(fetchMonitoringIncidents).mockResolvedValue(null)
    })
    afterEach(() => vi.useRealTimers())

    it("does not poll a parked OS window and resumes when it becomes active", async () => {
        const { rerender } = render(page(false))
        expect(mocks.getNetworkStats).not.toHaveBeenCalled()
        rerender(page(true))
        await act(async () => { await Promise.resolve(); await Promise.resolve() })
        expect(mocks.getNetworkStats).toHaveBeenCalledTimes(1)
        rerender(page(false))
        await act(async () => { await vi.advanceTimersByTimeAsync(120_000) })
        expect(mocks.getNetworkStats).toHaveBeenCalledTimes(1)
        rerender(page(true))
        await act(async () => { await Promise.resolve(); await Promise.resolve() })
        expect(mocks.getNetworkStats).toHaveBeenCalledTimes(2)
    })

    it("keeps independent live sources running when an initial RPC stats read rejects", async () => {
        mocks.getNetworkStats.mockRejectedValueOnce(new Error("RPC unavailable"))
        render(page(true))
        await act(async () => { await Promise.resolve(); await Promise.resolve() })
        expect(mocks.fetchChainHealth).toHaveBeenCalled()
        expect(mocks.getAggregatedNetPeers).toHaveBeenCalled()
        expect(screen.queryByText("RPC sample available")).not.toBeInTheDocument()
    })

    it("hides a failed peer sample instead of retaining a current-looking peer count", async () => {
        mocks.getAggregatedNetPeers
            .mockResolvedValueOnce({ listening: true, peers: [], peerCount: 0 })
            .mockResolvedValue(null)
        render(page(true))
        await act(async () => { await Promise.resolve(); await Promise.resolve() })
        await act(async () => { await vi.advanceTimersByTimeAsync(15_000) })
        expect(screen.getByLabelText("Network live status")).toHaveTextContent("Peers: —")
        expect(screen.getByText("Peer info unavailable for this RPC endpoint")).toBeInTheDocument()
    })

    it("removes the green RPC status when a later status refresh fails", async () => {
        mocks.getNetworkStats.mockResolvedValueOnce(stats).mockRejectedValue(new Error("RPC timeout"))
        render(page(true))
        await act(async () => { await Promise.resolve(); await Promise.resolve() })
        expect(screen.getByText("RPC sample available")).toBeInTheDocument()
        await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
        expect(screen.getByText("RPC sample unavailable")).toBeInTheDocument()
        expect(screen.queryByText("RPC synced")).not.toBeInTheDocument()
    })

    it("hides cached incidents when their refresh fails", async () => {
        vi.mocked(fetchMonitoringIncidents)
            .mockResolvedValueOnce([{ addr: "g1alpha", moniker: "alpha", severity: "WARNING", timestamp: new Date().toISOString(), details: "Missed blocks" }])
            .mockResolvedValue(null)
        render(page(true))
        await act(async () => { for (let i = 0; i < 12; i++) await Promise.resolve() })
        expect(screen.getByText(/WARNING: alpha/)).toBeInTheDocument()
        await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
        expect(screen.queryByText(/WARNING: alpha/)).not.toBeInTheDocument()
    })
})
