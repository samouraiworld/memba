/**
 * NetworkProofCard — the hero's live proof object. Honest states: live numbers,
 * loading skeleton, and an "offline" label (never fabricated numbers).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"

vi.mock("../../hooks/home/useNetworkPulse", () => ({ useNetworkPulse: vi.fn() }))

const { useNetworkPulse } = await import("../../hooks/home/useNetworkPulse")
const { NetworkProofCard } = await import("./NetworkProofCard")

const pulse = (over: Record<string, unknown> = {}) =>
    ({ blockHeight: 0, avgBlockTime: 0, totalValidators: 0, loading: false, offline: false, ...over })

beforeEach(() => vi.clearAllMocks())

describe("NetworkProofCard", () => {
    it("shows the live block height, validators and cadence", () => {
        vi.mocked(useNetworkPulse).mockReturnValue(pulse({ blockHeight: 478673, totalValidators: 10, avgBlockTime: 5 }))
        render(<NetworkProofCard />)
        expect(screen.getByText("478,673")).toBeInTheDocument()
        expect(screen.getByText(/network · live/i)).toBeInTheDocument()
        expect(screen.getByText(/10 validators/i)).toBeInTheDocument()
        expect(screen.getByText(/~5\.0s block/i)).toBeInTheDocument()
    })

    it("omits validators/cadence when zero (honest)", () => {
        vi.mocked(useNetworkPulse).mockReturnValue(pulse({ blockHeight: 100, totalValidators: 0, avgBlockTime: 0 }))
        render(<NetworkProofCard />)
        expect(screen.getByText("100")).toBeInTheDocument()
        expect(screen.queryByText(/validators/i)).not.toBeInTheDocument()
        expect(screen.queryByText(/block$/i)).not.toBeInTheDocument()
    })

    it("shows an offline label (never fabricated numbers) when the network is unreachable", () => {
        vi.mocked(useNetworkPulse).mockReturnValue(pulse({ offline: true }))
        render(<NetworkProofCard />)
        expect(screen.getByText(/network · offline/i)).toBeInTheDocument()
        expect(screen.getByText(/network status unavailable/i)).toBeInTheDocument()
    })
})
