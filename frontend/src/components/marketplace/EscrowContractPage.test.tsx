/**
 * EscrowContractPage — /:network/marketplace/services/contract/:contractId,
 * the link a client shares with the freelancer.
 */
import { screen, waitFor } from "@testing-library/react"
import { render } from "@testing-library/react"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { beforeEach, describe, expect, it, vi } from "vitest"
import EscrowContractPage from "./EscrowContractPage"
import type { EscrowContractView } from "../../lib/marketplace/escrowState"

const CLIENT = "g1747t5m2f08plqjlrjk2q0qld7465hxz8gkx59c"
const FREELANCER = "g1u7y667z64x2h7vc6fmpcprgey4ck233jaww9zq"

const wallet = vi.hoisted(() => ({ address: "" }))
vi.mock("../../hooks/useAdena", () => ({ useAdena: () => ({ address: wallet.address, connected: wallet.address !== "", connect: vi.fn() }) }))
vi.mock("../../lib/config", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../lib/config")>()),
    isServicesEnabled: () => true,
    isEscrowValid: () => true,
}))
const readEscrowContract = vi.hoisted(() => vi.fn(async (_p: string, id: string): Promise<EscrowContractView | null> => ({
    id, title: "Logo", description: "", client: "g1747t5m2f08plqjlrjk2q0qld7465hxz8gkx59c", freelancer: "g1u7y667z64x2h7vc6fmpcprgey4ck233jaww9zq",
    status: "active", createdAt: 10, fundedAt: 11, refundAt: 864_011, expireAt: null, resolveAt: null,
    milestones: [{ index: 0, title: "A", amountUgnot: 1_000, status: "funded", fundedAt: 11, completedAt: null, disputedAt: null, refundAt: 864_011, resolveAt: null }],
    totals: { amountUgnot: 1_000, escrowedUgnot: 1_000, releasedUgnot: 0, refundedUgnot: 0 },
})))
vi.mock("../../lib/marketplace/escrowState", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../lib/marketplace/escrowState")>()),
    readEscrowContract,
    readEscrowPauseState: async () => ({ paused: false, exitsOpen: true, exitsReopenAt: 0, pausedBlocks: 0 }),
}))
vi.mock("../../lib/dao/proposalDates", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../lib/dao/proposalDates")>()),
    getCurrentBlock: async () => 1_000,
}))

const visit = (path: string, state?: unknown) => render(
    <MemoryRouter initialEntries={[{ pathname: path, state }]}>
        <Routes>
            <Route path="/:network/marketplace/services/contract/:contractId" element={<EscrowContractPage />} />
        </Routes>
    </MemoryRouter>,
)

beforeEach(() => {
    wallet.address = ""
    readEscrowContract.mockClear()
})

describe("EscrowContractPage", () => {
    it("reads the contract named in the URL and offers its link", async () => {
        visit("/mainnet/marketplace/services/contract/42")
        await screen.findByTestId("escrow-contract-details")
        expect(readEscrowContract).toHaveBeenCalledWith(expect.any(String), "42")
        expect(screen.getByRole("heading", { name: "Escrow contract 42" })).toBeInTheDocument()
        expect(screen.getByLabelText("Contract link")).toHaveValue(`${window.location.origin}/mainnet/marketplace/services/contract/42`)
        expect(screen.getByRole("link", { name: /Services/ })).toHaveAttribute("href", "/mainnet/marketplace/services")
        expect(screen.getByTestId("escrow-role-note")).toHaveTextContent(/Connect the client's or the freelancer's wallet/)
    })

    it("gives the freelancer who opens the shared link their calls", async () => {
        wallet.address = FREELANCER
        visit("/mainnet/marketplace/services/contract/42")
        expect(await screen.findByRole("button", { name: "Mark delivered" })).toBeEnabled()
    })

    it("after creation, asks the client to share the link", async () => {
        wallet.address = CLIENT
        visit("/mainnet/marketplace/services/contract/42", { created: true })
        expect(await screen.findByTestId("escrow-created")).toHaveTextContent("Share this link with your freelancer:")
    })

    it("refuses an id that is not a contract id, without reading the chain", async () => {
        visit("/mainnet/marketplace/services/contract/07")
        expect(screen.getByRole("alert")).toHaveTextContent(/does not name a contract/)
        await waitFor(() => expect(readEscrowContract).not.toHaveBeenCalled())
    })
})
