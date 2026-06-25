/**
 * GovDaoSpotlight.test.tsx — the gold Layer-1 governance spotlight that replaces
 * the MembaDAO featured hero. Always renders GovDAO; shows live open-proposal /
 * member stats when present (omitted when absent — honesty); retry on error.
 */
import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"

vi.mock("../../hooks/home/useGovDao", () => ({
    useGovDao: vi.fn(),
    GOVDAO_REALM_PATH: "gno.land/r/gov/dao",
}))

const { useGovDao } = await import("../../hooks/home/useGovDao")
const { GovDaoSpotlight } = await import("./GovDaoSpotlight")

const HREF = "/test13/dao/gno.land/r/gov/dao"
const renderIt = () => render(<MemoryRouter><GovDaoSpotlight networkKey="test13" /></MemoryRouter>)

describe("GovDaoSpotlight", () => {
    it("renders the GovDAO name, a Layer-1 eyebrow, and a Monitor CTA to the dao href", () => {
        vi.mocked(useGovDao).mockReturnValue({ state: "ready", name: "GovDAO", openCount: 3, members: 61, href: HREF, refetch: vi.fn() })
        renderIt()
        expect(screen.getByText("GovDAO")).toBeInTheDocument()
        expect(screen.getByText(/layer 1/i)).toBeInTheDocument()
        expect(screen.getByRole("link", { name: /monitor governance/i })).toHaveAttribute("href", HREF)
        expect(screen.getByText(/3 open proposals/i)).toBeInTheDocument()
        expect(screen.getByText(/61 members/i)).toBeInTheDocument()
    })

    it("singularizes stats for exactly one (1 member / 1 open proposal)", () => {
        vi.mocked(useGovDao).mockReturnValue({ state: "ready", name: "GovDAO", openCount: 1, members: 1, href: HREF, refetch: vi.fn() })
        renderIt()
        expect(screen.getByText(/^1 open proposal$/i)).toBeInTheDocument()
        expect(screen.getByText(/^1 member$/i)).toBeInTheDocument()
    })

    it("omits proposal/member stats when absent (never fabricates 0)", () => {
        vi.mocked(useGovDao).mockReturnValue({ state: "ready", name: "GovDAO", href: HREF, refetch: vi.fn() })
        renderIt()
        expect(screen.queryByText(/open proposal/i)).not.toBeInTheDocument()
        expect(screen.queryByText(/\bmembers\b/i)).not.toBeInTheDocument()
        expect(screen.getByText("GovDAO")).toBeInTheDocument()
    })

    it("shows a retry that calls refetch on error", () => {
        const refetch = vi.fn()
        vi.mocked(useGovDao).mockReturnValue({ state: "error", name: "GovDAO", href: HREF, refetch })
        renderIt()
        fireEvent.click(screen.getByRole("button", { name: /retry/i }))
        expect(refetch).toHaveBeenCalledTimes(1)
    })
})
