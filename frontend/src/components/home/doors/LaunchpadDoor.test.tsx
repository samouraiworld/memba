/**
 * LaunchpadDoor.test.tsx — the launchpad card shows a live mini token-card for
 * the newest token (name + ticker + on-chain supply + creator) plus the total
 * count. Honest: supply/creator omitted when absent; an empty factory shows the
 * promo, never a fabricated "0".
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import type { TokenLaunch } from "../../../hooks/home/useTokenLaunches"

vi.mock("../../../hooks/home/useTokenLaunches", () => ({ useTokenLaunches: vi.fn() }))

const { useTokenLaunches } = await import("../../../hooks/home/useTokenLaunches")
const { LaunchpadDoor } = await import("./LaunchpadDoor")

const launch = (over: Partial<TokenLaunch> = {}): TokenLaunch =>
    ({ slug: "HOT", name: "Canicule", symbol: "HOT", path: "gno.land/r/x/factory:HOT", ...over })
const renderIt = () => render(<MemoryRouter><LaunchpadDoor networkKey="test13" /></MemoryRouter>)

beforeEach(() => vi.clearAllMocks())

describe("LaunchpadDoor", () => {
    it("shows a mini token-card with name, ticker, supply, holders, creator and total count", () => {
        vi.mocked(useTokenLaunches).mockReturnValue({
            tokens: [launch({ supplyDisplay: "102.5001", holders: 2, admin: "g1abcdefghijklmnopqrstuvwxyz0123456789zz" })],
            total: 3,
            loading: false,
        })
        renderIt()
        expect(screen.getByText("Canicule")).toBeInTheDocument()
        expect(screen.getByText("$HOT")).toBeInTheDocument()
        expect(screen.getByText(/102\.5001 supply/)).toBeInTheDocument()
        expect(screen.getByText(/2 holders/i)).toBeInTheDocument()
        expect(screen.getByText(/by g1abcd/i)).toBeInTheDocument()
        expect(screen.getByText(/3 tokens on the launchpad/i)).toBeInTheDocument()
    })

    it("omits supply/creator when unavailable (honest) but still shows the token", () => {
        vi.mocked(useTokenLaunches).mockReturnValue({ tokens: [launch()], total: 1, loading: false })
        renderIt()
        expect(screen.getByText("Canicule")).toBeInTheDocument()
        expect(screen.getByText(/1 token on the launchpad/i)).toBeInTheDocument()
        expect(screen.queryByText(/supply/i)).not.toBeInTheDocument()
        expect(screen.queryByText(/^by /i)).not.toBeInTheDocument()
    })

    it("falls back to the promo (never a fabricated 0) when there are no tokens", () => {
        vi.mocked(useTokenLaunches).mockReturnValue({ tokens: [], total: 0, loading: false })
        renderIt()
        expect(screen.getByText(/launch a token in minutes/i)).toBeInTheDocument()
        expect(screen.queryByText("0")).not.toBeInTheDocument()
    })
})
