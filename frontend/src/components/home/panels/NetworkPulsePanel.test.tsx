/**
 * NetworkPulsePanel.test.tsx
 *
 * Per-panel isolation contract:
 *   1. With data → stat values render in the DOM
 *   2. Loading    → skeleton cards render (no real values)
 *   3. Error/zero → panel shows "—", NEVER throws
 */

import { describe, it, expect, vi } from "vitest"
import { screen } from "@testing-library/react"
import { renderWithProviders } from "../../../test/test-utils"
import { NetworkPulsePanel } from "./NetworkPulsePanel"

vi.mock("../../../hooks/home/useNetworkPulse", () => ({
    useNetworkPulse: vi.fn(() => ({
        blockHeight: 0,
        avgBlockTime: 0,
        totalValidators: 0,
        daoCount: 0,
        memberCount: 0,
        loading: false,
    })),
}))

// Resolve for per-test control
const pulseMod = await import("../../../hooks/home/useNetworkPulse")

describe("NetworkPulsePanel — with data", () => {
    it("renders block time stat", () => {
        vi.mocked(pulseMod.useNetworkPulse).mockReturnValue({
            blockHeight: 99000,
            avgBlockTime: 2.4,
            totalValidators: 5,
            daoCount: 10,
            memberCount: 42,
            loading: false,
        })
        renderWithProviders(<NetworkPulsePanel />)
        expect(screen.getByText("2.4 s")).toBeInTheDocument()
    })

    it("renders validator count stat", () => {
        vi.mocked(pulseMod.useNetworkPulse).mockReturnValue({
            blockHeight: 99000,
            avgBlockTime: 2.4,
            totalValidators: 5,
            daoCount: 10,
            memberCount: 42,
            loading: false,
        })
        renderWithProviders(<NetworkPulsePanel />)
        expect(screen.getByText("5")).toBeInTheDocument()
    })

    it("renders contributor count stat", () => {
        vi.mocked(pulseMod.useNetworkPulse).mockReturnValue({
            blockHeight: 99000,
            avgBlockTime: 2.4,
            totalValidators: 5,
            daoCount: 10,
            memberCount: 42,
            loading: false,
        })
        renderWithProviders(<NetworkPulsePanel />)
        expect(screen.getByText("42")).toBeInTheDocument()
    })

    it("renders the panel container testid", () => {
        vi.mocked(pulseMod.useNetworkPulse).mockReturnValue({
            blockHeight: 1,
            avgBlockTime: 2.0,
            totalValidators: 3,
            daoCount: 4,
            memberCount: 5,
            loading: false,
        })
        renderWithProviders(<NetworkPulsePanel />)
        expect(screen.getByTestId("network-pulse-panel")).toBeInTheDocument()
    })
})

describe("NetworkPulsePanel — loading", () => {
    it("shows skeleton cards while loading", () => {
        vi.mocked(pulseMod.useNetworkPulse).mockReturnValue({
            blockHeight: 0,
            avgBlockTime: 0,
            totalValidators: 0,
            daoCount: 0,
            memberCount: 0,
            loading: true,
        })
        renderWithProviders(<NetworkPulsePanel />)
        const skeletons = screen.getAllByTestId("action-card-skeleton")
        expect(skeletons.length).toBeGreaterThanOrEqual(1)
    })
})

describe("NetworkPulsePanel — error / zero data", () => {
    it("shows em-dash (or '— s') for zero values (not loading)", () => {
        vi.mocked(pulseMod.useNetworkPulse).mockReturnValue({
            blockHeight: 0,
            avgBlockTime: 0,
            totalValidators: 0,
            daoCount: 0,
            memberCount: 0,
            loading: false,
        })
        renderWithProviders(<NetworkPulsePanel />)
        // avgBlockTime=0 renders "— s", validators and members render "—"
        expect(screen.getByText("— s")).toBeInTheDocument()
        const dashes = screen.getAllByText("—")
        // validators + contributors = at least 2
        expect(dashes.length).toBeGreaterThanOrEqual(2)
    })

    it("does NOT throw when hook returns zero data", () => {
        vi.mocked(pulseMod.useNetworkPulse).mockReturnValue({
            blockHeight: 0,
            avgBlockTime: 0,
            totalValidators: 0,
            daoCount: 0,
            memberCount: 0,
            loading: false,
        })
        // If it throws renderWithProviders itself will throw — test would fail
        expect(() => renderWithProviders(<NetworkPulsePanel />)).not.toThrow()
    })

    it("panel container still renders when values are zero", () => {
        vi.mocked(pulseMod.useNetworkPulse).mockReturnValue({
            blockHeight: 0,
            avgBlockTime: 0,
            totalValidators: 0,
            daoCount: 0,
            memberCount: 0,
            loading: false,
        })
        renderWithProviders(<NetworkPulsePanel />)
        expect(screen.getByTestId("network-pulse-panel")).toBeInTheDocument()
    })
})
