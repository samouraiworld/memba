/**
 * Hire by address, end to end in the Services lane: the form's checks, the
 * warnings it shows, the hire dialog signing the CreateContract the form
 * checked, and the landing on the new contract's shareable page once the
 * contract is read back (or a note under My contracts when it is not yet).
 */
import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { Route, Routes, useLocation } from "react-router-dom"
import { renderWithProviders } from "../../test/test-utils"
import ServiceLane from "./ServiceLane"
import type { EscrowPauseState } from "../../lib/marketplace/escrowState"

const CLIENT = "g1747t5m2f08plqjlrjk2q0qld7465hxz8gkx59c"
const FREELANCER = "g1u7y667z64x2h7vc6fmpcprgey4ck233jaww9zq"
const ESCROW = "gno.land/r/samcrew/escrow_v4"

const wallet = vi.hoisted(() => ({ connected: true }))
vi.mock("../../hooks/useAdena", () => ({
    useAdena: () => ({ address: wallet.connected ? "g1747t5m2f08plqjlrjk2q0qld7465hxz8gkx59c" : "", connected: wallet.connected, connect: vi.fn() }),
}))

vi.mock("../../lib/config", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../lib/config")>()),
    isServicesEnabled: () => true,
    isEscrowValid: () => true,
    getIndexerUrl: () => null,
}))

const doContractBroadcast = vi.hoisted(() => vi.fn<(...args: unknown[]) => Promise<{ hash: string }>>(async () => ({ hash: "TX" })))
vi.mock("../../lib/grc20", async (importOriginal) => ({ ...(await importOriginal<typeof import("../../lib/grc20")>()), doContractBroadcast }))

const chain = vi.hoisted(() => ({
    pause: { paused: false, exitsOpen: true, exitsReopenAt: 0, pausedBlocks: 0 } as EscrowPauseState,
    created: "13" as string | null,
}))
const findCreatedContract = vi.hoisted(() => vi.fn(async () => chain.created))
vi.mock("../../lib/marketplace/escrowState", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../lib/marketplace/escrowState")>()),
    readEscrowPauseState: async () => chain.pause,
    readClientActiveCount: async () => 0,
    readCreatedCount: async () => 13,
    readClientContracts: async () => ({ items: [], next: null }),
    findCreatedContract,
}))
vi.mock("../../lib/dao/proposalDates", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../lib/dao/proposalDates")>()),
    getCurrentBlock: async () => 300_000,
}))

function Landed() {
    const { pathname, state } = useLocation()
    return <div data-testid="landed">{`${pathname} ${JSON.stringify(state)}`}</div>
}

const renderLane = () => renderWithProviders(
    <Routes>
        <Route path="/:network/marketplace/services" element={<ServiceLane />} />
        <Route path="/:network/marketplace/services/contract/:contractId" element={<Landed />} />
    </Routes>,
    { route: "/mainnet/marketplace/services" },
)

const openForm = async () => {
    renderLane()
    const open = await screen.findByTestId("hire-by-address-open")
    await waitFor(() => expect(open).toBeEnabled())
    fireEvent.click(open)
    return screen.getByTestId("hire-by-address")
}

const fill = (form: HTMLElement, v: { freelancer?: string; title?: string; amounts?: string[] }) => {
    fireEvent.change(within(form).getByLabelText("Freelancer address"), { target: { value: v.freelancer ?? FREELANCER } })
    fireEvent.change(within(form).getByLabelText("Title"), { target: { value: v.title ?? "Logo design" } })
    const amounts = v.amounts ?? ["1.5"]
    amounts.forEach((a, i) => {
        if (i > 0) fireEvent.click(within(form).getByRole("button", { name: "Add milestone" }))
        fireEvent.change(within(form).getByLabelText(`Milestone ${i + 1} title`), { target: { value: `Part ${i + 1}` } })
        fireEvent.change(within(form).getByLabelText(`Milestone ${i + 1} amount in GNOT`), { target: { value: a } })
    })
}

beforeEach(() => {
    wallet.connected = true
    chain.pause = { paused: false, exitsOpen: true, exitsReopenAt: 0, pausedBlocks: 0 }
    chain.created = "13"
    doContractBroadcast.mockClear()
    findCreatedContract.mockClear()
})

describe("ServiceLane — hire by address", () => {
    it("states what creating the contract commits: per-milestone escrow, the deposit, the fee and the cap", async () => {
        const form = await openForm()
        fill(form, {})
        const terms = within(form).getByTestId("hire-by-address-terms")
        expect(terms).toHaveTextContent(/fund each milestone later with its exact amount/)
        expect(terms).toHaveTextContent(/storage deposit \(up to \d+(\.\d+)? GNOT for this contract/)
        expect(terms).toHaveTextContent(/comes back to you when you archive/)
        expect(terms).toHaveTextContent(/at most 5%/)
        expect(terms).toHaveTextContent(/at most 5 open contracts/)
        expect(within(form).getByTestId("hire-by-address-total")).toHaveTextContent("1.5 GNOT")
    })

    it("refuses an address with a bad checksum, on its field, without opening the dialog", async () => {
        const form = await openForm()
        fill(form, { freelancer: "g1u7y667z64x2h7vc6fmpcprgey4ck233jaww9zr" })
        fireEvent.click(within(form).getByRole("button", { name: "Review and sign" }))
        expect(within(form).getByRole("alert")).toHaveTextContent(/not a valid gno.land address/)
        expect(within(form).getByLabelText("Freelancer address")).toHaveAttribute("aria-invalid", "true")
        expect(screen.queryByRole("button", { name: /sign escrow tx/i })).not.toBeInTheDocument()
    })

    it("refuses a milestone below the realm minimum", async () => {
        const form = await openForm()
        fill(form, { amounts: ["0.0001"] })
        fireEvent.click(within(form).getByRole("button", { name: "Review and sign" }))
        expect(within(form).getByRole("alert")).toHaveTextContent(/at least 1000 ugnot/)
    })

    it("signs the CreateContract the form checked, then lands on the new contract's page", async () => {
        const form = await openForm()
        fill(form, { amounts: ["1.5", "0.25"] })
        fireEvent.click(within(form).getByRole("button", { name: "Review and sign" }))
        const sign = await screen.findByRole("button", { name: /sign escrow tx/i })
        await waitFor(() => expect(sign).toBeEnabled())
        fireEvent.click(sign)
        expect(await screen.findByTestId("landed")).toHaveTextContent('/mainnet/marketplace/services/contract/13 {"created":true}')
        const [msgs] = doContractBroadcast.mock.calls[0] as unknown as [{ value: Record<string, unknown> }[]]
        expect(msgs[0].value).toMatchObject({ caller: CLIENT, pkg_path: ESCROW, func: "CreateContract", args: [FREELANCER, "Logo design", "", "Part 1:1500000,Part 2:250000"], send: "" })
        expect(findCreatedContract).toHaveBeenCalledWith(ESCROW, CLIENT, 13, expect.objectContaining({ freelancer: FREELANCER, title: "Logo design" }))
    })

    it("when the new contract cannot be read back yet, stays on the lane and says where it will appear", async () => {
        chain.created = null
        const form = await openForm()
        fill(form, {})
        fireEvent.click(within(form).getByRole("button", { name: "Review and sign" }))
        const sign = await screen.findByRole("button", { name: /sign escrow tx/i })
        await waitFor(() => expect(sign).toBeEnabled())
        fireEvent.click(sign)
        expect(await screen.findByTestId("hire-notice")).toHaveTextContent(/will appear under My contracts/)
        expect(screen.queryByTestId("landed")).not.toBeInTheDocument()
    })

    it("is closed while escrow is paused", async () => {
        chain.pause = { paused: true, exitsOpen: true, exitsReopenAt: 100_000, pausedBlocks: 183_273 }
        renderLane()
        expect(await screen.findByTestId("escrow-hiring-closed")).toHaveTextContent(/paused/)
        expect(screen.getByTestId("hire-by-address-open")).toBeDisabled()
    })

    it("asks for a wallet first", async () => {
        wallet.connected = false
        renderLane()
        const open = await screen.findByTestId("hire-by-address-open")
        await waitFor(() => expect(open).toBeEnabled())
        fireEvent.click(open)
        expect(screen.queryByTestId("hire-by-address")).not.toBeInTheDocument()
        // The lane's error toast (its wording is mapped by errorMap).
        expect(await screen.findByRole("alert")).toBeInTheDocument()
    })
})
