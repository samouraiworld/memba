/**
 * GovDaoSpotlight.test.tsx — the gold Layer-1 governance spotlight that replaces
 * the MembaDAO featured hero. Two columns: a left identity rail (name + eyebrow +
 * desc + Monitor CTA + stats) and a right "latest governance" rail that previews
 * the newest proposals (filling what used to be dead space). Always renders
 * GovDAO; stats omitted when absent (honesty); honest empty/loading/error states.
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
const prop = (id: number, over: Record<string, unknown> = {}) => ({
    id, title: `Proposal ${id}`, status: "open" as const, href: `${HREF}/proposal/${id}`, ...over,
})
const renderIt = () => render(<MemoryRouter><GovDaoSpotlight networkKey="test13" /></MemoryRouter>)

describe("GovDaoSpotlight", () => {
    it("renders the GovDAO name, a Layer-1 eyebrow, and a Monitor CTA to the dao href", () => {
        vi.mocked(useGovDao).mockReturnValue({ state: "ready", name: "GovDAO", openCount: 3, members: 61, latestProposals: [], href: HREF, refetch: vi.fn() })
        renderIt()
        expect(screen.getByText("GovDAO")).toBeInTheDocument()
        expect(screen.getByText(/layer 1/i)).toBeInTheDocument()
        expect(screen.getByText(/the constitution of gno\.land/i)).toBeInTheDocument()
        expect(screen.getByRole("link", { name: /monitor governance/i })).toHaveAttribute("href", HREF)
        expect(screen.getByText(/3 open proposals/i)).toBeInTheDocument()
        expect(screen.getByText(/61 members/i)).toBeInTheDocument()
    })

    it("previews the latest proposals as links to each proposal, plus a view-all link and the threshold", () => {
        vi.mocked(useGovDao).mockReturnValue({
            state: "ready", name: "GovDAO", openCount: 2, members: 61, threshold: "66%",
            latestProposals: [
                prop(12, { title: "Raise the validator cap", status: "executed", yesPercent: 80 }),
                prop(11, { title: "Adjust min-fee" }),
            ],
            href: HREF, refetch: vi.fn(),
        })
        renderIt()
        // a "latest governance" rail with each proposal as a deep link
        expect(screen.getByText(/latest governance/i)).toBeInTheDocument()
        const row = screen.getByRole("link", { name: /raise the validator cap/i })
        expect(row).toHaveAttribute("href", `${HREF}/proposal/12`)
        expect(screen.getByRole("link", { name: /adjust min-fee/i })).toHaveAttribute("href", `${HREF}/proposal/11`)
        // vote% shown only when present
        expect(screen.getByText(/80%/)).toBeInTheDocument()
        // a catch-all view-all link to the dao, and the threshold stat
        expect(screen.getByRole("link", { name: /view all proposals/i })).toHaveAttribute("href", HREF)
        expect(screen.getByText(/66% threshold/i)).toBeInTheDocument()
    })

    it("singularizes stats for exactly one (1 member / 1 open proposal)", () => {
        vi.mocked(useGovDao).mockReturnValue({ state: "ready", name: "GovDAO", openCount: 1, members: 1, latestProposals: [], href: HREF, refetch: vi.fn() })
        renderIt()
        expect(screen.getByText(/^1 open proposal$/i)).toBeInTheDocument()
        expect(screen.getByText(/^1 member$/i)).toBeInTheDocument()
    })

    it("shows an honest empty state (no proposal links) when there are no proposals", () => {
        vi.mocked(useGovDao).mockReturnValue({ state: "ready", name: "GovDAO", latestProposals: [], href: HREF, refetch: vi.fn() })
        const { container } = renderIt()
        expect(screen.getByText(/no proposals yet/i)).toBeInTheDocument()
        expect(container.querySelectorAll(".govdao-spotlight__prop")).toHaveLength(0)
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
