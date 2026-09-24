/**
 * EscrowContractPanel — My contracts (the connected client's contracts, paged
 * newest first), archive (client, settled contract, refund estimate) and
 * expire (anyone, never-funded contract past the realm's expireAt), both held
 * while a pause's blocking window is open, and neither broadcast while the
 * services lane is gated.
 */
import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { renderWithProviders } from "../../test/test-utils"
import { EscrowContractPanel } from "./EscrowContractPanel"
import type { EscrowContractsPage, EscrowContractView, EscrowPauseState } from "../../lib/marketplace/escrowState"

const gate = vi.hoisted(() => ({ live: true }))
vi.mock("../../lib/config", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../lib/config")>()),
    isServicesEnabled: () => gate.live,
    isEscrowValid: () => gate.live,
}))

const doContractBroadcast = vi.hoisted(() => vi.fn(async () => ({ hash: "TX" })))
vi.mock("../../lib/grc20", async (importOriginal) => ({ ...(await importOriginal<typeof import("../../lib/grc20")>()), doContractBroadcast }))

const CLIENT = "g1747t5m2f08plqjlrjk2q0qld7465hxz8gkx59c"
const FREELANCER = "g1u7y667z64x2h7vc6fmpcprgey4ck233jaww9zq"
const ESCROW = "gno.land/r/samcrew/escrow_v4"

const OPEN: EscrowPauseState = { paused: false, exitsOpen: true, exitsReopenAt: 0, pausedBlocks: 0 }

const chain = vi.hoisted(() => ({
    contract: null as EscrowContractView | null,
    pause: { paused: false, exitsOpen: true, exitsReopenAt: 0, pausedBlocks: 0 } as EscrowPauseState,
    height: 2_000_000,
}))
const readEscrowContract = vi.hoisted(() => vi.fn<(path: string, id: string) => Promise<EscrowContractView | null>>(async () => chain.contract))
const pages = vi.hoisted(() => ({ byCursor: {} as Record<string, EscrowContractsPage | Error> }))
const readClientContracts = vi.hoisted(() => vi.fn<(path: string, client: string, before?: string) => Promise<EscrowContractsPage>>(async (_p, _c, before = "") => {
    const page = pages.byCursor[before] ?? { items: [], next: null }
    if (page instanceof Error) throw page
    return page
}))
vi.mock("../../lib/marketplace/escrowState", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../lib/marketplace/escrowState")>()),
    readEscrowContract,
    readClientContracts,
    readEscrowPauseState: async () => chain.pause,
}))
vi.mock("../../lib/dao/proposalDates", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../lib/dao/proposalDates")>()),
    getCurrentBlock: async () => chain.height,
}))

const milestone = (status: EscrowContractView["milestones"][number]["status"]) =>
    ({ index: 0, title: "A", amountUgnot: 1000, status, fundedAt: null, completedAt: null, disputedAt: null, refundAt: null, resolveAt: null })

const contract = (over: Partial<EscrowContractView> = {}): EscrowContractView => ({
    id: "7",
    title: "Logo",
    description: "",
    client: CLIENT,
    freelancer: FREELANCER,
    status: "completed",
    createdAt: 1_000,
    fundedAt: null,
    refundAt: null,
    expireAt: null,
    resolveAt: null,
    milestones: [milestone("released")],
    totals: { amountUgnot: 1000, escrowedUgnot: 0, releasedUgnot: 1000, refundedUgnot: 0 },
    ...over,
})

const lookUp = async (caller: string, id = "7") => {
    renderWithProviders(<EscrowContractPanel caller={caller} />)
    fireEvent.change(screen.getByLabelText("Contract id"), { target: { value: id } })
    fireEvent.click(screen.getByRole("button", { name: /look up/i }))
    await waitFor(() => expect(screen.queryByTestId("escrow-contract-details") ?? screen.queryByTestId("escrow-contract-missing")).not.toBeNull())
}

beforeEach(() => {
    gate.live = true
    chain.contract = null
    chain.pause = OPEN
    chain.height = 2_000_000
    pages.byCursor = {}
    doContractBroadcast.mockClear()
    readEscrowContract.mockClear()
    readClientContracts.mockClear()
})

describe("EscrowContractPanel — archive", () => {
    it("offers the client of a settled contract to archive it, with the estimated refund", async () => {
        chain.contract = contract()
        await lookUp(CLIENT)
        const button = screen.getByRole("button", { name: "Archive and reclaim deposit (~0.67 GNOT)" })
        expect(button).toBeEnabled()
        expect(screen.getByTestId("escrow-archive")).toHaveTextContent(/refunds the freed storage deposit to the signer, which is you, the client/)
    })

    it("signs ArchiveContract for the id with the flat cap, then reads the contract again", async () => {
        chain.contract = contract()
        await lookUp(CLIENT)
        chain.contract = null
        fireEvent.click(screen.getByRole("button", { name: /archive and reclaim deposit/i }))
        await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/archived/))
        const [msgs, , opts] = doContractBroadcast.mock.calls[0] as unknown as [{ value: Record<string, unknown> }[], string, Record<string, unknown>]
        expect(msgs[0].value).toMatchObject({ caller: CLIENT, pkg_path: ESCROW, func: "ArchiveContract", args: ["7"], send: "", max_deposit: "200000ugnot" })
        expect(opts).toMatchObject({ gasWanted: 39_000_000, retry: false })
        expect(await screen.findByTestId("escrow-contract-missing")).toHaveTextContent("Contract 7 does not exist or has been archived.")
        expect(readEscrowContract).toHaveBeenCalledTimes(2)
    })

    it("does not offer archiving to anyone but the client", async () => {
        chain.contract = contract()
        await lookUp(FREELANCER)
        expect(screen.queryByRole("button", { name: /archive/i })).not.toBeInTheDocument()
        expect(screen.getByTestId("escrow-archive-client-only")).toHaveTextContent("Only the client can archive this contract.")
    })

    it("disables archiving of an open contract", async () => {
        chain.contract = contract({ status: "active", milestones: [milestone("funded")] })
        await lookUp(CLIENT)
        expect(screen.getByRole("button", { name: /archive and reclaim deposit/i })).toBeDisabled()
        expect(screen.getByTestId("escrow-archive")).toHaveTextContent(/Only a completed or cancelled contract/)
    })

    it("holds archiving inside a pause's blocking window and names the reopen block", async () => {
        chain.contract = contract()
        chain.pause = { paused: true, exitsOpen: false, exitsReopenAt: 2_100_000, pausedBlocks: 5 }
        await lookUp(CLIENT)
        expect(screen.getByRole("button", { name: /archive and reclaim deposit/i })).toBeDisabled()
        expect(screen.getByTestId("escrow-archive")).toHaveTextContent(/reopens at block 2,100,000 \(about 4 days\)/)
    })

    it("never broadcasts while the services lane is gated", async () => {
        chain.contract = contract()
        await lookUp(CLIENT)
        gate.live = false
        fireEvent.click(screen.getByRole("button", { name: /archive and reclaim deposit/i }))
        expect(await screen.findByRole("alert")).toHaveTextContent(/not available/)
        expect(doContractBroadcast).not.toHaveBeenCalled()
    })
})

describe("EscrowContractPanel — expire", () => {
    const unfunded = () => contract({ status: "active", createdAt: 1_000, expireAt: 865_000, milestones: [milestone("pending")] })

    it("lets anyone expire a never-funded contract past UnfundedExpiryBlks", async () => {
        chain.contract = unfunded()
        chain.height = 865_000
        await lookUp(FREELANCER)
        fireEvent.click(screen.getByRole("button", { name: "Expire unfunded contract" }))
        await waitFor(() => expect(doContractBroadcast).toHaveBeenCalledTimes(1))
        const [msgs] = doContractBroadcast.mock.calls[0] as unknown as [{ value: Record<string, unknown> }[]]
        expect(msgs[0].value).toMatchObject({ caller: FREELANCER, func: "ExpireUnfunded", args: ["7"], send: "" })
    })

    it("says from which block it can be expired, before then", async () => {
        chain.contract = unfunded()
        chain.height = 800_000
        await lookUp(FREELANCER)
        expect(screen.getByRole("button", { name: "Expire unfunded contract" })).toBeDisabled()
        expect(screen.getByTestId("escrow-expire")).toHaveTextContent(/from block 865,000 \(about 3 days\)/)
    })

    it("needs a wallet to sign", async () => {
        chain.contract = unfunded()
        chain.height = 865_000
        await lookUp("")
        expect(screen.getByRole("button", { name: "Expire unfunded contract" })).toBeDisabled()
        expect(screen.getByTestId("escrow-expire")).toHaveTextContent(/Connect a wallet/)
    })

    it("is not offered for a contract that was funded", async () => {
        chain.contract = contract({ status: "active", milestones: [milestone("funded")] })
        await lookUp(FREELANCER)
        expect(screen.queryByRole("button", { name: /expire/i })).not.toBeInTheDocument()
    })
})

describe("EscrowContractPanel — lookup", () => {
    it("refuses an id that is not a whole number, without reading the chain", async () => {
        renderWithProviders(<EscrowContractPanel caller={CLIENT} />)
        fireEvent.change(screen.getByLabelText("Contract id"), { target: { value: "07" } })
        fireEvent.click(screen.getByRole("button", { name: /look up/i }))
        expect(screen.getByRole("alert")).toHaveTextContent(/whole number/)
        expect(readEscrowContract).not.toHaveBeenCalled()
    })

    it("reads the id from the active escrow realm", async () => {
        chain.contract = contract()
        await lookUp(CLIENT, "42")
        expect(readEscrowContract).toHaveBeenCalledWith(ESCROW, "42")
    })
})

describe("EscrowContractPanel — My contracts", () => {
    const item = (id: string, status: "active" | "completed" | "cancelled" = "active") => ({ id, status, createdAt: 100 + Number(id) })

    it("lists the connected client's contracts newest first and opens one", async () => {
        pages.byCursor[""] = { items: [item("12"), item("9", "completed")], next: null }
        chain.contract = contract({ id: "9" })
        renderWithProviders(<EscrowContractPanel caller={CLIENT} />)
        const list = await screen.findByTestId("escrow-my-contracts")
        await waitFor(() => expect(within(list).getAllByRole("listitem")).toHaveLength(2))
        expect(within(list).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
            "#12active · created at block 112",
            "#9completed · created at block 109",
        ])
        expect(readClientContracts).toHaveBeenCalledWith(ESCROW, CLIENT, "")
        fireEvent.click(within(list).getByRole("button", { name: "Open contract 9" }))
        await screen.findByTestId("escrow-contract-details")
        expect(readEscrowContract).toHaveBeenCalledWith(ESCROW, "9")
        expect(screen.queryByRole("button", { name: /load older/i })).not.toBeInTheDocument()
    })

    it("follows the next cursor to load older contracts", async () => {
        pages.byCursor[""] = { items: [item("12"), item("9")], next: "9" }
        pages.byCursor["9"] = { items: [item("4", "cancelled")], next: null }
        renderWithProviders(<EscrowContractPanel caller={CLIENT} />)
        fireEvent.click(await screen.findByRole("button", { name: /load older contracts/i }))
        const list = screen.getByTestId("escrow-my-contracts")
        await waitFor(() => expect(within(list).getAllByRole("listitem")).toHaveLength(3))
        expect(readClientContracts).toHaveBeenLastCalledWith(ESCROW, CLIENT, "9")
        expect(screen.queryByRole("button", { name: /load older contracts/i })).not.toBeInTheDocument()
    })

    it("says so when the client has no stored contracts", async () => {
        renderWithProviders(<EscrowContractPanel caller={CLIENT} />)
        expect(await screen.findByText(/have not created any escrow contracts/)).toBeInTheDocument()
    })

    it("shows a read error instead of an empty list", async () => {
        pages.byCursor[""] = new Error("Unexpected escrow answer: page order")
        renderWithProviders(<EscrowContractPanel caller={CLIENT} />)
        expect(await screen.findByText(/Could not load your contracts: Unexpected escrow answer/)).toBeInTheDocument()
        expect(screen.queryByText(/have not created any/)).not.toBeInTheDocument()
    })

    it("reads nothing without a wallet, or while the lane is gated", async () => {
        renderWithProviders(<EscrowContractPanel caller="" />)
        gate.live = false
        renderWithProviders(<EscrowContractPanel caller={CLIENT} />)
        expect(screen.queryByTestId("escrow-my-contracts")).not.toBeInTheDocument()
        expect(readClientContracts).not.toHaveBeenCalled()
    })

    it("after a hire lands, re-reads the list and opens the new contract", async () => {
        pages.byCursor[""] = { items: [item("9")], next: null }
        const { rerender } = renderWithProviders(<EscrowContractPanel caller={CLIENT} createdContract={{ id: null, n: 0 }} />)
        await waitFor(() => expect(readClientContracts).toHaveBeenCalledTimes(1))
        pages.byCursor[""] = { items: [item("13"), item("9")], next: null }
        chain.contract = contract({ id: "13", status: "active", expireAt: 865_000, milestones: [milestone("pending")] })
        rerender(<EscrowContractPanel caller={CLIENT} createdContract={{ id: "13", n: 1 }} />)
        await waitFor(() => expect(within(screen.getByTestId("escrow-my-contracts")).getAllByRole("listitem")).toHaveLength(2))
        await screen.findByTestId("escrow-contract-details")
        expect(readEscrowContract).toHaveBeenCalledWith(ESCROW, "13")
        expect(screen.getByLabelText("Contract id")).toHaveValue("13")
    })
})
