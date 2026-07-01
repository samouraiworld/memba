/**
 * HireServiceModal.test.tsx — W0.2 containment.
 *
 * This flow previously built a CreateContract tx against the non-deployable
 * `memba_escrow_v1` realm with `send: ""`, while that realm panics unless exactly one
 * ugnot is attached — i.e. every "Sign Escrow Tx" would revert on-chain after the user
 * signs (gas burned, confusing failure). Wave 0 makes it fail-closed: the action must
 * surface an honest "not available yet" message and MUST NOT broadcast anything.
 */
import { screen, fireEvent } from "@testing-library/react"
import { describe, it, expect, vi } from "vitest"
import { renderWithProviders } from "../../test/test-utils"
import { HireServiceModal, type Service } from "./HireServiceModal"

const adena = { address: "g1client", connected: true, connect: vi.fn() }
vi.mock("../../hooks/useAdena", () => ({ useAdena: () => adena }))

const doContractBroadcast = vi.fn()
vi.mock("../../lib/grc20", () => ({ doContractBroadcast: (...a: unknown[]) => doContractBroadcast(...a) }))

const service: Service = {
    id: "svc-1",
    title: "Smart Contract Audit",
    freelancer: "g1freelancer",
    description: "audit",
    priceUgnot: 500_000_000,
    milestones: "Deposit:250000000,Final:250000000",
    category: "Security",
    image: "🛡️",
}

describe("HireServiceModal — fail-closed (W0.2)", () => {
    it("does not broadcast a reverting escrow tx: clicking Sign surfaces 'not available' and never calls doContractBroadcast", async () => {
        const onSuccess = vi.fn()
        renderWithProviders(<HireServiceModal service={service} onClose={vi.fn()} onSuccess={onSuccess} />)

        fireEvent.click(screen.getByRole("button", { name: /sign escrow tx/i }))

        expect(await screen.findByText(/not available|coming soon|not yet/i)).toBeInTheDocument()
        expect(doContractBroadcast).not.toHaveBeenCalled()
        expect(onSuccess).not.toHaveBeenCalled()
    })
})
