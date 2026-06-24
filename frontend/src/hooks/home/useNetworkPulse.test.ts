/**
 * useNetworkPulse.test.ts
 *
 * Covers the snapshot-first behaviour introduced in Phase E1:
 *   1. Snapshot usable → blockHeight/totalValidators come from the snapshot;
 *      getNetworkStats is NOT called (statsQuery is disabled).
 *      daoCount/memberCount always come from traction.
 *   2. Snapshot NOT usable → getNetworkStats IS called; its values are returned.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"
import React from "react"

// ── Module-level mocks ────────────────────────────────────────

vi.mock("./useHomeSnapshot", () => ({
    useHomeSnapshot: vi.fn(),
}))

vi.mock("../../lib/validators", () => ({
    getNetworkStats: vi.fn(),
}))

vi.mock("../../lib/traction", () => ({
    fetchTractionMetrics: vi.fn(),
}))

vi.mock("../useNetwork", () => ({
    useNetwork: vi.fn(() => ({
        networkKey: "test13",
        rpcUrl: "https://rpc.test13.gno.land",
    })),
}))

// ── Resolve mocked modules for per-test control ───────────────

const snapshotMod = await import("./useHomeSnapshot")
const validatorMod = await import("../../lib/validators")
const tractionMod = await import("../../lib/traction")

// ── Wrapper ───────────────────────────────────────────────────

function makeWrapper() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return function Wrapper({ children }: { children: ReactNode }) {
        return React.createElement(QueryClientProvider, { client }, children)
    }
}

// ── Fixtures ──────────────────────────────────────────────────

const SNAPSHOT_NETWORK_DATA = {
    network: {
        blockHeight: BigInt(123456),
        avgBlockTimeMs: BigInt(2500),
        validatorsTotal: 14,
    },
}

const TRACTION_DATA = {
    daoCount: 8,
    contributorCount: 55,
}

// ── Tests ─────────────────────────────────────────────────────

describe("useNetworkPulse — snapshot usable", () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it("returns blockHeight and totalValidators from the snapshot", async () => {
        vi.mocked(snapshotMod.useHomeSnapshot).mockReturnValue({
            snapshot: SNAPSHOT_NETWORK_DATA as never,
            usable: true,
            isLoading: false,
        })
        vi.mocked(tractionMod.fetchTractionMetrics).mockResolvedValue(TRACTION_DATA)

        const { useNetworkPulse } = await import("./useNetworkPulse")
        const { result } = renderHook(() => useNetworkPulse(), { wrapper: makeWrapper() })

        await waitFor(() => expect(result.current.loading).toBe(false))

        // Values from snapshot
        expect(result.current.blockHeight).toBe(123456)
        expect(result.current.totalValidators).toBe(14)
        // avgBlockTimeMs=2500ms → 2.5s
        expect(result.current.avgBlockTime).toBeCloseTo(2.5)
    })

    it("does NOT call getNetworkStats when the snapshot is usable", async () => {
        vi.mocked(snapshotMod.useHomeSnapshot).mockReturnValue({
            snapshot: SNAPSHOT_NETWORK_DATA as never,
            usable: true,
            isLoading: false,
        })
        vi.mocked(tractionMod.fetchTractionMetrics).mockResolvedValue(TRACTION_DATA)

        const { useNetworkPulse } = await import("./useNetworkPulse")
        const { result } = renderHook(() => useNetworkPulse(), { wrapper: makeWrapper() })

        await waitFor(() => expect(result.current.loading).toBe(false))

        expect(validatorMod.getNetworkStats).not.toHaveBeenCalled()
    })

    it("still returns daoCount and memberCount from traction", async () => {
        vi.mocked(snapshotMod.useHomeSnapshot).mockReturnValue({
            snapshot: SNAPSHOT_NETWORK_DATA as never,
            usable: true,
            isLoading: false,
        })
        vi.mocked(tractionMod.fetchTractionMetrics).mockResolvedValue(TRACTION_DATA)

        const { useNetworkPulse } = await import("./useNetworkPulse")
        const { result } = renderHook(() => useNetworkPulse(), { wrapper: makeWrapper() })

        await waitFor(() => expect(result.current.memberCount).toBe(55))

        expect(result.current.daoCount).toBe(8)
        expect(result.current.memberCount).toBe(55)
    })
})

describe("useNetworkPulse — snapshot NOT usable (on-chain fallback)", () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it("calls getNetworkStats when snapshot is not usable", async () => {
        vi.mocked(snapshotMod.useHomeSnapshot).mockReturnValue({
            snapshot: null,
            usable: false,
            isLoading: false,
        })
        vi.mocked(validatorMod.getNetworkStats).mockResolvedValue({
            blockHeight: 99000,
            avgBlockTime: 2.0,
            totalValidators: 7,
        })
        vi.mocked(tractionMod.fetchTractionMetrics).mockResolvedValue(TRACTION_DATA)

        const { useNetworkPulse } = await import("./useNetworkPulse")
        const { result } = renderHook(() => useNetworkPulse(), { wrapper: makeWrapper() })

        await waitFor(() => expect(result.current.loading).toBe(false))

        expect(validatorMod.getNetworkStats).toHaveBeenCalled()
        expect(result.current.blockHeight).toBe(99000)
        expect(result.current.totalValidators).toBe(7)
        expect(result.current.avgBlockTime).toBeCloseTo(2.0)
    })

    it("sets offline=true when getNetworkStats errors (RPC down), false otherwise", async () => {
        vi.mocked(snapshotMod.useHomeSnapshot).mockReturnValue({
            snapshot: null,
            usable: false,
            isLoading: false,
        })
        vi.mocked(validatorMod.getNetworkStats).mockRejectedValue(new Error("RPC down"))
        vi.mocked(tractionMod.fetchTractionMetrics).mockResolvedValue(TRACTION_DATA)

        const { useNetworkPulse } = await import("./useNetworkPulse")
        const { result } = renderHook(() => useNetworkPulse(), { wrapper: makeWrapper() })

        await waitFor(() => expect(result.current.loading).toBe(false))
        // Truthful UI: the StatusStrip must be able to show "offline" rather than
        // a "live" dot when the network stats query failed.
        expect(result.current.offline).toBe(true)
    })

    it("still returns daoCount and memberCount from traction on fallback", async () => {
        vi.mocked(snapshotMod.useHomeSnapshot).mockReturnValue({
            snapshot: null,
            usable: false,
            isLoading: false,
        })
        vi.mocked(validatorMod.getNetworkStats).mockResolvedValue({
            blockHeight: 1,
            avgBlockTime: 1.0,
            totalValidators: 1,
        })
        vi.mocked(tractionMod.fetchTractionMetrics).mockResolvedValue(TRACTION_DATA)

        const { useNetworkPulse } = await import("./useNetworkPulse")
        const { result } = renderHook(() => useNetworkPulse(), { wrapper: makeWrapper() })

        await waitFor(() => expect(result.current.memberCount).toBe(55))

        expect(result.current.daoCount).toBe(8)
    })
})
