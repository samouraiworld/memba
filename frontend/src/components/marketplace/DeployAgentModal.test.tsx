/**
 * DeployAgentModal.test.tsx — W0.2 containment.
 *
 * The agent-credit purchase flow is NOT production-ready (the real on-chain credit
 * path lives in CreditSection). This modal previously FAKED success via
 * `setTimeout(1500)` then `onSuccess()` — a deceptive money-path UI. Wave 0 makes it
 * fail-closed: the action must surface a clear "not available yet" message and MUST
 * NOT report success or broadcast anything.
 */
import { screen, fireEvent } from "@testing-library/react"
import { describe, it, expect, vi } from "vitest"
import { renderWithProviders } from "../../test/test-utils"
import { DeployAgentModal } from "./DeployAgentModal"
import type { AgentListing } from "../../lib/agentRegistry"

const adena = { address: "g1buyer", connected: true, connect: vi.fn() }
vi.mock("../../hooks/useAdena", () => ({ useAdena: () => adena }))

const agent = {
    id: "agent-1",
    name: "Test Agent",
    pricing: "pay-per-use",
    pricePerCall: 1,
} as unknown as AgentListing

describe("DeployAgentModal — fail-closed (W0.2)", () => {
    it("does not fake success: clicking Purchase Credits surfaces 'not available' and never calls onSuccess", async () => {
        const onSuccess = vi.fn()
        const onClose = vi.fn()
        renderWithProviders(<DeployAgentModal agent={agent} onClose={onClose} onSuccess={onSuccess} />)

        fireEvent.click(screen.getByRole("button", { name: /purchase credits/i }))

        expect(await screen.findByText(/not available|coming soon|not yet/i)).toBeInTheDocument()
        expect(onSuccess).not.toHaveBeenCalled()
    })
})
