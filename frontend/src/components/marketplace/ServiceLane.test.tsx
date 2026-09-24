/**
 * ServiceLane.test.tsx — W0.2 containment.
 *
 * The lane previously shipped hardcoded MOCK_SERVICES with dummy freelancer addresses
 * (g1samouraicoop, g1frontenddev, …) rendered as if they were real, hireable listings.
 * Wave 0 removes the fake data: the lane shows an honest empty/coming-soon state until
 * real on-chain service listings exist.
 */
import { screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, it, expect, vi } from "vitest"
import { renderWithProviders } from "../../test/test-utils"
import ServiceLane from "./ServiceLane"
import type { EscrowPauseState } from "../../lib/marketplace/escrowState"

vi.mock("../../hooks/useAdena", () => ({ useAdena: () => ({ address: "", connected: false, connect: vi.fn() }) }))

const gate = vi.hoisted(() => ({ live: false }))
vi.mock("../../lib/config", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../lib/config")>()),
    isServicesEnabled: () => gate.live,
    isEscrowValid: () => gate.live,
}))

const chain = vi.hoisted(() => ({
    pause: { paused: false, exitsOpen: true, exitsReopenAt: 0, pausedBlocks: 0 } as EscrowPauseState | Error,
    height: 300_000,
}))
const readEscrowPauseState = vi.hoisted(() => vi.fn(async () => {
    if (chain.pause instanceof Error) throw chain.pause
    return chain.pause
}))
vi.mock("../../lib/marketplace/escrowState", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../lib/marketplace/escrowState")>()),
    readEscrowPauseState,
    readClientContracts: async () => ({ items: [], next: null }),
}))
vi.mock("../../lib/dao/proposalDates", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../lib/dao/proposalDates")>()),
    getCurrentBlock: async () => chain.height,
}))

beforeEach(() => {
    gate.live = false
    chain.pause = { paused: false, exitsOpen: true, exitsReopenAt: 0, pausedBlocks: 0 }
    readEscrowPauseState.mockClear()
})

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

describe("ServiceLane — curated listings follow the lane's gate", () => {
    it("shows none while the lane is gated, and the curated card once it is live", async () => {
        const { unmount } = renderWithProviders(<ServiceLane />)
        await screen.findByText(/no services yet/i)
        expect(screen.queryByTestId("curated-services")).not.toBeInTheDocument()
        unmount()
        gate.live = true
        renderWithProviders(<ServiceLane />)
        expect(await screen.findByTestId("curated-service-samourai-coop-dev")).toBeInTheDocument()
        expect(screen.queryByText(/no services yet/i)).not.toBeInTheDocument()
    })
})

describe("ServiceLane — hiring follows the escrow realm's pause state", () => {
    it("reads nothing while the lane is gated on this network", async () => {
        renderWithProviders(<ServiceLane />)
        await screen.findByText(/no services yet/i)
        expect(readEscrowPauseState).not.toHaveBeenCalled()
        expect(screen.queryByTestId("escrow-hiring-closed")).not.toBeInTheDocument()
    })

    it("shows no paused state when the realm takes new contracts", async () => {
        gate.live = true
        renderWithProviders(<ServiceLane />)
        await waitFor(() => expect(readEscrowPauseState).toHaveBeenCalledWith("gno.land/r/samcrew/escrow_v4"))
        expect(screen.queryByTestId("escrow-hiring-closed")).not.toBeInTheDocument()
    })

    it("says new contracts are refused while the realm is paused", async () => {
        gate.live = true
        chain.pause = { paused: true, exitsOpen: false, exitsReopenAt: 480_000, pausedBlocks: 10 }
        renderWithProviders(<ServiceLane />)
        const banner = await screen.findByTestId("escrow-hiring-closed")
        expect(banner).toHaveTextContent(/paused: new contracts and funding are refused/i)
        expect(banner).toHaveTextContent(/480,000/)
    })

    it("fails closed when the pause state cannot be read", async () => {
        gate.live = true
        chain.pause = new Error("rpc down")
        renderWithProviders(<ServiceLane />)
        const banner = await screen.findByTestId("escrow-hiring-closed")
        expect(banner).toHaveTextContent(/could not read the escrow contract's pause state \(rpc down\)/i)
    })
})
