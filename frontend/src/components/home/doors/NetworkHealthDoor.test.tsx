/**
 * NetworkHealthDoor — P0-A2 page-level halt consistency. When the chain is
 * stalled/unreachable the door must tell the truth ("network stalled"), not a
 * misleading "X / Y healthy" (the validator set looks healthy on the home even
 * during a halt). When the chain is fine it shows the normal validator health.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"

vi.mock("../../../hooks/home/useValidatorHealth", () => ({ useValidatorHealth: vi.fn() }))
vi.mock("../../../hooks/home/useNetworkPulse", () => ({ useNetworkPulse: vi.fn() }))
vi.mock("../../../hooks/home/useBlockTimeSeries", () => ({ useBlockTimeSeries: vi.fn() }))
vi.mock("../../../hooks/home/useChainHealth", () => ({ useChainHealth: vi.fn() }))

const { useValidatorHealth } = await import("../../../hooks/home/useValidatorHealth")
const { useNetworkPulse } = await import("../../../hooks/home/useNetworkPulse")
const { useBlockTimeSeries } = await import("../../../hooks/home/useBlockTimeSeries")
const { useChainHealth } = await import("../../../hooks/home/useChainHealth")
const { NetworkHealthDoor } = await import("./NetworkHealthDoor")

const renderIt = () => render(<MemoryRouter><NetworkHealthDoor networkKey="test13" /></MemoryRouter>)

beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useValidatorHealth).mockReturnValue({ status: "healthy", active: 10, total: 10, loading: false } as never)
    vi.mocked(useNetworkPulse).mockReturnValue({ blockHeight: 478673, avgBlockTime: 5, totalValidators: 10, loading: false, offline: false } as never)
    vi.mocked(useBlockTimeSeries).mockReturnValue({ series: [] } as never)
    vi.mocked(useChainHealth).mockReturnValue({ health: "healthy", degraded: false, blockAge: 5, loading: false })
})

describe("NetworkHealthDoor — halt consistency (P0-A2)", () => {
    it("shows normal validator health when the chain is fine", () => {
        renderIt()
        expect(screen.getByText(/10 \/ 10/)).toBeInTheDocument()
        expect(screen.getByText(/^healthy$/i)).toBeInTheDocument()
        expect(screen.queryByTestId("network-health-stalled")).toBeNull()
    })

    it("shows 'network stalled' (not 'healthy') when the chain is halted", () => {
        vi.mocked(useChainHealth).mockReturnValue({ health: "halted", degraded: true, blockAge: 3600, loading: false })
        renderIt()
        expect(screen.getByTestId("network-health-stalled")).toHaveTextContent(/network stalled/i)
        expect(screen.getByText(/last block 1h ago/i)).toBeInTheDocument()
        // It must NOT also claim the validators are healthy.
        expect(screen.queryByText(/10 \/ 10/)).toBeNull()
        expect(screen.queryByText(/^healthy$/i)).toBeNull()
    })

    it("shows 'unreachable' when the network can't be reached", () => {
        vi.mocked(useChainHealth).mockReturnValue({ health: "unreachable", degraded: true, blockAge: Infinity, loading: false })
        renderIt()
        expect(screen.getByTestId("network-health-stalled")).toHaveTextContent(/unreachable/i)
    })
})
