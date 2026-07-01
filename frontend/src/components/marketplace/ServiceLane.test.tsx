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

        expect(screen.getByText(/coming soon|no services|not available/i)).toBeInTheDocument()
        expect(screen.queryByText("Smart Contract Audit")).not.toBeInTheDocument()
        expect(screen.queryByText(/g1samouraicoop|g1frontenddev/)).not.toBeInTheDocument()
    })
})
