/**
 * NetworkHealthDoor.sparkline.test.tsx — R2-H4a block-time sparkline.
 *
 * Mirrors the hook-mock style of ContributorsDoor.test.tsx. Asserts:
 *   - sparkline SVG is PRESENT when the interval series is non-empty,
 *   - sparkline is ABSENT when the series is empty (honesty — no fake flat line),
 *   - the sparkline renders one polyline point per series entry,
 *   - the polyline is token-colored via the accent CSS variable,
 *   - the whole card stays a single link (no nested anchor from the SVG).
 *
 * Mutation guard: the "absent-when-empty" test fails if the door ever renders a
 * sparkline unconditionally.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import type { ValidatorHealth } from "../../../hooks/home/useValidatorHealth"
import type { NetworkPulse } from "../../../hooks/home/useNetworkPulse"
import type { BlockTimeSeries } from "../../../hooks/home/useBlockTimeSeries"

vi.mock("../../../hooks/home/useValidatorHealth", () => ({ useValidatorHealth: vi.fn() }))
vi.mock("../../../hooks/home/useNetworkPulse", () => ({ useNetworkPulse: vi.fn() }))
vi.mock("../../../hooks/home/useBlockTimeSeries", () => ({ useBlockTimeSeries: vi.fn() }))
vi.mock("../../../hooks/home/useChainHealth", () => ({ useChainHealth: vi.fn() }))

const { useValidatorHealth } = await import("../../../hooks/home/useValidatorHealth")
const { useNetworkPulse } = await import("../../../hooks/home/useNetworkPulse")
const { useBlockTimeSeries } = await import("../../../hooks/home/useBlockTimeSeries")
const { useChainHealth } = await import("../../../hooks/home/useChainHealth")
const { NetworkHealthDoor } = await import("./NetworkHealthDoor")

const HEALTHY: ValidatorHealth = {
    status: "healthy", active: 14, total: 14, avgUptime: null, latestIncident: null, loading: false,
}
const PULSE: NetworkPulse = { blockHeight: 457174, avgBlockTime: 2.4, totalValidators: 14, loading: false, offline: false }
const series = (s: number[]): BlockTimeSeries => ({ series: s, loading: false, error: false })

const renderIt = () => render(<MemoryRouter><NetworkHealthDoor networkKey="test13" /></MemoryRouter>)

describe("NetworkHealthDoor — block-time sparkline", () => {
    beforeEach(() => {
        vi.mocked(useValidatorHealth).mockReturnValue(HEALTHY)
        vi.mocked(useNetworkPulse).mockReturnValue(PULSE)
        // Chain healthy by default so the door renders the normal stat/sparkline path.
        vi.mocked(useChainHealth).mockReturnValue({ health: "healthy", degraded: false, blockAge: 3, loading: false })
    })

    it("renders the sparkline SVG when the interval series is non-empty", () => {
        vi.mocked(useBlockTimeSeries).mockReturnValue(series([2, 3, 2, 4, 2]))
        const { container } = renderIt()
        const svg = container.querySelector("svg.network-health-door__spark")
        expect(svg).not.toBeNull()
        const poly = container.querySelector(".network-health-door__spark polyline")
        expect(poly).not.toBeNull()
        // one point per series entry
        const pts = (poly?.getAttribute("points") ?? "").trim().split(/\s+/).filter(Boolean)
        expect(pts).toHaveLength(5)
    })

    it("colors the sparkline with the accent token (no hard-coded hex)", () => {
        vi.mocked(useBlockTimeSeries).mockReturnValue(series([2, 3, 2]))
        const { container } = renderIt()
        const poly = container.querySelector(".network-health-door__spark polyline") as SVGPolylineElement | null
        expect(poly?.getAttribute("stroke")).toBe("var(--color-k-accent)")
    })

    it("does NOT render a sparkline when the series is empty (no fake flat line)", () => {
        vi.mocked(useBlockTimeSeries).mockReturnValue(series([]))
        const { container } = renderIt()
        expect(container.querySelector("svg.network-health-door__spark")).toBeNull()
    })

    it("does NOT render a sparkline when the series hook errors", () => {
        vi.mocked(useBlockTimeSeries).mockReturnValue({ series: [], loading: false, error: true })
        const { container } = renderIt()
        expect(container.querySelector("svg.network-health-door__spark")).toBeNull()
    })

    it("keeps the whole card a single link — the SVG adds no nested anchor", () => {
        vi.mocked(useBlockTimeSeries).mockReturnValue(series([2, 3, 2]))
        const { container } = renderIt()
        expect(container.querySelectorAll("a").length).toBe(1)
        expect(container.querySelector("a.door")).toHaveAttribute("href", "/test13/validators")
    })

    it("still shows the existing count + block metrics alongside the sparkline", () => {
        vi.mocked(useBlockTimeSeries).mockReturnValue(series([2, 3]))
        const { getByText } = renderIt()
        expect(getByText(/14 \/ 14/)).toBeInTheDocument()
        expect(getByText(/457,174/)).toBeInTheDocument()
    })
})
