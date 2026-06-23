/**
 * StatusStrip.test.tsx
 *
 * Covers the truthful network-status dot: the strip must show "offline" (not a
 * misleading "live" dot) when the network pulse query failed, and must hide the
 * live stats in that state.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import type { NetworkPulse } from "../../hooks/home/useNetworkPulse"

vi.mock("../../hooks/useNetwork", () => ({
    useNetwork: vi.fn(() => ({ label: "test13" })),
}))

vi.mock("../../hooks/home/useNetworkPulse", () => ({
    useNetworkPulse: vi.fn(),
}))

const pulseMod = await import("../../hooks/home/useNetworkPulse")
const { StatusStrip } = await import("./StatusStrip")

function mockPulse(overrides: Partial<NetworkPulse>) {
    vi.mocked(pulseMod.useNetworkPulse).mockReturnValue({
        blockHeight: 123,
        avgBlockTime: 2,
        totalValidators: 14,
        daoCount: 0,
        memberCount: 0,
        loading: false,
        offline: false,
        ...overrides,
    })
}

describe("StatusStrip — truthful status dot", () => {
    beforeEach(() => vi.clearAllMocks())

    it("shows a 'live' dot and stats when online", () => {
        mockPulse({ offline: false, loading: false })
        render(<StatusStrip />)
        const dot = screen.getByLabelText("live")
        expect(dot.className).not.toContain("status-strip__dot--offline")
        expect(screen.getByTestId("status-block-height")).toBeTruthy()
        expect(screen.getByTestId("status-validators")).toBeTruthy()
    })

    it("shows an 'offline' dot and hides stats when the pulse query failed", () => {
        mockPulse({ offline: true, loading: false })
        render(<StatusStrip />)
        const dot = screen.getByLabelText("offline")
        expect(dot.className).toContain("status-strip__dot--offline")
        // Stats must be hidden — never show stale "live" numbers when offline.
        expect(screen.queryByTestId("status-block-height")).toBeNull()
        expect(screen.queryByTestId("status-validators")).toBeNull()
    })

    it("shows a 'syncing' dot while loading", () => {
        mockPulse({ loading: true, offline: false })
        render(<StatusStrip />)
        expect(screen.getByLabelText("syncing")).toBeTruthy()
    })
})
