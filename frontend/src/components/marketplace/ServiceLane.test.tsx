/**
 * ServiceLane.test.tsx — W0.2 containment.
 *
 * The lane previously shipped hardcoded MOCK_SERVICES with dummy freelancer addresses
 * (g1samouraicoop, g1frontenddev, …) rendered as if they were real, hireable listings.
 * Wave 0 removes the fake data: the lane shows an honest empty/coming-soon state until
 * real on-chain service listings exist.
 */
import { screen } from "@testing-library/react"
import { describe, it, expect, vi } from "vitest"
import { renderWithProviders } from "../../test/test-utils"
import ServiceLane from "./ServiceLane"

vi.mock("../../hooks/useAdena", () => ({ useAdena: () => ({ address: "", connected: false, connect: vi.fn() }) }))

describe("ServiceLane — no fake listings (W0.2)", () => {
    it("shows an empty/coming-soon state and does NOT render mock services or dummy addresses", () => {
        renderWithProviders(<ServiceLane />)

        // The empty state is now the shared EmptyState (title + body), so the
        // coming-soon signal spans two nodes — assert at least one carries it.
        expect(screen.getAllByText(/coming soon|no services|not available/i).length).toBeGreaterThan(0)
        expect(screen.queryByText("Smart Contract Audit")).not.toBeInTheDocument()
        expect(screen.queryByText(/g1samouraicoop|g1frontenddev/)).not.toBeInTheDocument()
    })
})

describe("ServiceLane — shared EmptyState parity (A7)", () => {
    it("renders the shared EmptyState component (not a raw one-line div)", () => {
        const { container } = renderWithProviders(<ServiceLane />)
        // The shared component always emits the .emptystate wrapper + title/body.
        expect(container.querySelector(".emptystate")).toBeInTheDocument()
        expect(container.querySelector(".emptystate__title")).toBeInTheDocument()
        expect(container.querySelector(".emptystate__body")).toBeInTheDocument()
    })
})
