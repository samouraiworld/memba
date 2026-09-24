/**
 * EscrowContractDetail — what the realm reports, the calls the connected
 * address can make, the exact message each one signs, the re-read after a call
 * lands, no retry when the outcome is unknown, and nothing offered from a read
 * that failed or was malformed.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { renderWithProviders } from "../../test/test-utils"
import { EscrowContractDetail } from "./EscrowContractDetail"
import { EscrowViewError, type EscrowContractView, type EscrowMilestoneView, type EscrowPauseState } from "../../lib/marketplace/escrowState"

const gate = vi.hoisted(() => ({ live: true }))
vi.mock("../../lib/config", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../lib/config")>()),
    isServicesEnabled: () => gate.live,
    isEscrowValid: () => gate.live,
}))

const doContractBroadcast = vi.hoisted(() => vi.fn<(...args: unknown[]) => Promise<{ hash: string }>>(async () => ({ hash: "TX" })))
vi.mock("../../lib/grc20", async (importOriginal) => ({ ...(await importOriginal<typeof import("../../lib/grc20")>()), doContractBroadcast }))

const CLIENT = "g1747t5m2f08plqjlrjk2q0qld7465hxz8gkx59c"
const FREELANCER = "g1u7y667z64x2h7vc6fmpcprgey4ck233jaww9zq"
const STRANGER = "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5"
const ESCROW = "gno.land/r/samcrew/escrow_v4"

const OPEN: EscrowPauseState = { paused: false, exitsOpen: true, exitsReopenAt: 0, pausedBlocks: 0 }

const chain = vi.hoisted(() => ({
    contract: null as EscrowContractView | null | Error,
    pause: { paused: false, exitsOpen: true, exitsReopenAt: 0, pausedBlocks: 0 } as EscrowPauseState,
    height: 2_000_000,
}))
const readEscrowContract = vi.hoisted(() => vi.fn(async () => {
    if (chain.contract instanceof Error) throw chain.contract
    return chain.contract
}))
const readEscrowPauseState = vi.hoisted(() => vi.fn(async () => chain.pause))
vi.mock("../../lib/marketplace/escrowState", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../lib/marketplace/escrowState")>()),
    readEscrowContract,
    readEscrowPauseState,
}))
vi.mock("../../lib/dao/proposalDates", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../lib/dao/proposalDates")>()),
    getCurrentBlock: async () => chain.height,
}))

const ms = (index: number, status: EscrowMilestoneView["status"], over: Partial<EscrowMilestoneView> = {}): EscrowMilestoneView => ({
    index, title: `Milestone ${index}`, amountUgnot: 1_500_000, status,
    fundedAt: null, completedAt: null, disputedAt: null, refundAt: null, resolveAt: null, ...over,
})

const contract = (over: Partial<EscrowContractView> = {}): EscrowContractView => ({
    id: "7", title: "Logo", description: "Two concepts.", client: CLIENT, freelancer: FREELANCER, status: "active", createdAt: 1_000,
    fundedAt: null, refundAt: null, expireAt: 865_000, resolveAt: null, milestones: [ms(0, "pending"), ms(1, "pending", { amountUgnot: 2_000 })],
    totals: { amountUgnot: 1_502_000, escrowedUgnot: 0, releasedUgnot: 0, refundedUgnot: 0 }, ...over,
})

const show = async (caller: string, props: Partial<Parameters<typeof EscrowContractDetail>[0]> = {}) => {
    renderWithProviders(<EscrowContractDetail id="7" caller={caller} {...props} />)
    await waitFor(() => expect(screen.queryByTestId("escrow-contract-details") ?? screen.queryByTestId("escrow-contract-missing") ?? screen.queryByRole("alert")).not.toBeNull())
}

const lastSigned = () => {
    const [msgs, memo, opts] = doContractBroadcast.mock.calls.at(-1) as unknown as [{ value: Record<string, unknown> }[], string, Record<string, unknown>]
    return { msg: msgs[0].value, memo, opts }
}

beforeEach(() => {
    gate.live = true
    chain.contract = contract()
    chain.pause = OPEN
    chain.height = 2_000_000
    doContractBroadcast.mockReset()
    doContractBroadcast.mockImplementation(async () => ({ hash: "TX" }))
    readEscrowContract.mockClear()
    readEscrowPauseState.mockClear()
})

describe("EscrowContractDetail — what it shows", () => {
    it("shows the contract as read: parties in full, totals, fee terms and milestones", async () => {
        await show(STRANGER)
        const details = screen.getByTestId("escrow-contract-details")
        expect(within(details).getByText(CLIENT)).toBeInTheDocument()
        expect(within(details).getByText(FREELANCER)).toBeInTheDocument()
        expect(screen.getByTestId("escrow-total")).toHaveTextContent("1.502 GNOT")
        expect(screen.getByTestId("escrow-escrowed")).toHaveTextContent("0 GNOT")
        expect(screen.getByTestId("escrow-fee-terms")).toHaveTextContent(/at most 5%/)
        expect(screen.getByTestId("escrow-milestone-0")).toHaveTextContent("1. Milestone 0 — 1.5 GNOTNot funded")
        expect(screen.getByTestId("escrow-role-note")).toHaveTextContent(/not a party/)
        expect(readEscrowContract).toHaveBeenCalledWith(ESCROW, "7")
    })

    it("reveals invisible characters in text read from the chain", async () => {
        chain.contract = contract({ title: "Logo‮gpj.exe", milestones: [ms(0, "pending", { title: "A​B" })] })
        await show(CLIENT)
        expect(screen.getByText("Logo[U+202E]gpj.exe")).toBeInTheDocument()
        expect(screen.getByTestId("escrow-milestone-0")).toHaveTextContent("A[U+200B]B")
    })

    it("says the contract is gone when the realm reports it absent", async () => {
        chain.contract = null
        await show(CLIENT)
        expect(screen.getByTestId("escrow-contract-missing")).toHaveTextContent("Contract 7 does not exist or has been archived.")
    })

    it("offers nothing from a malformed read (fail closed)", async () => {
        chain.contract = new EscrowViewError("Unexpected escrow answer: milestone 0 status \"paid\"")
        await show(CLIENT)
        expect(screen.getByRole("alert")).toHaveTextContent(/Unexpected escrow answer/)
        expect(screen.queryByRole("button", { name: /fund|cancel|dispute|release/i })).not.toBeInTheDocument()
    })

    it("reads nothing while the services lane is gated", async () => {
        gate.live = false
        await show(CLIENT)
        expect(screen.getByRole("alert")).toHaveTextContent("Service escrow is not available on this network yet.")
        expect(readEscrowContract).not.toHaveBeenCalled()
    })

    it("offers the link, or asks the client to share it right after creating", async () => {
        await show(STRANGER, { shareUrl: "https://memba.example/mainnet/marketplace/services/contract/7" })
        expect(screen.getByLabelText("Contract link")).toHaveValue("https://memba.example/mainnet/marketplace/services/contract/7")
        expect(screen.queryByTestId("escrow-created")).not.toBeInTheDocument()
    })

    it("right after creation, tells the client to share the link with the freelancer", async () => {
        await show(CLIENT, { shareUrl: "https://memba.example/mainnet/marketplace/services/contract/7", justCreated: true })
        const created = screen.getByTestId("escrow-created")
        expect(created).toHaveTextContent("Share this link with your freelancer:")
        expect(within(created).getByLabelText("Contract link")).toHaveValue("https://memba.example/mainnet/marketplace/services/contract/7")
        expect(within(created).getByRole("button", { name: /Copy https:\/\/memba.example/ })).toBeInTheDocument()
        expect(screen.getAllByTestId("escrow-share")).toHaveLength(1)
    })
})

describe("EscrowContractDetail — calls", () => {
    it("the client funds a milestone with exactly its stored amount, then the contract is read again", async () => {
        await show(CLIENT)
        chain.contract = contract({ milestones: [ms(0, "funded", { fundedAt: 2_000_001, refundAt: 2_864_001 }), ms(1, "pending", { amountUgnot: 2_000 })] })
        fireEvent.click(within(screen.getByTestId("escrow-fund-0")).getByRole("button", { name: "Fund milestone (1.5 GNOT)" }))
        await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Milestone 1 of contract 7 is funded."))
        const { msg, memo, opts } = lastSigned()
        expect(msg).toMatchObject({ caller: CLIENT, pkg_path: ESCROW, func: "FundMilestone", args: ["7", "0"], send: "1500000ugnot" })
        expect(memo).toBe("Fund escrow 7 milestone 0")
        expect(opts).toMatchObject({ retry: false })
        expect(readEscrowContract).toHaveBeenCalledTimes(2)
        expect(screen.getByTestId("escrow-milestone-0")).toHaveTextContent("Funded, in escrow")
        expect(screen.queryByTestId("escrow-fund-0")).not.toBeInTheDocument()
        expect(within(screen.getByTestId("escrow-fund-1")).getByRole("button")).toHaveTextContent("Fund milestone (0.002 GNOT)")
    })

    it("holds a just-sent call back if the node has not applied it yet", async () => {
        await show(CLIENT)
        fireEvent.click(within(screen.getByTestId("escrow-fund-0")).getByRole("button"))
        await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/is funded/))
        const row = screen.getByTestId("escrow-fund-0")
        expect(within(row).getByRole("button")).toBeDisabled()
        expect(row).toHaveTextContent(/Sent a moment ago/)
        expect(within(screen.getByTestId("escrow-fund-1")).getByRole("button")).toBeEnabled()
    })

    it.each([
        ["freelancer marks a funded milestone delivered", FREELANCER, [ms(0, "funded")], "escrow-complete-0", "Mark delivered", "CompleteMilestone", ["7", "0"]],
        ["client releases a delivered milestone", CLIENT, [ms(0, "completed")], "escrow-release-0", "Release payment", "ReleaseFunds", ["7", "0"]],
        ["freelancer disputes", FREELANCER, [ms(0, "completed")], "escrow-dispute-0", "Raise dispute", "RaiseDispute", ["7", "0"]],
        ["client cancels", CLIENT, [ms(0, "funded")], "escrow-cancel", "Cancel contract", "CancelContract", ["7"]],
        ["anyone refunds past the deadline", STRANGER, [ms(0, "funded", { refundAt: 1_900_000 })], "escrow-claimRefund-0", "Refund to client", "ClaimRefund", ["7", "0"]],
    ] as const)("%s", async (_name, caller, milestones, testId, label, func, args) => {
        chain.contract = contract({ expireAt: null, milestones: [...milestones] })
        await show(caller)
        fireEvent.click(within(screen.getByTestId(testId)).getByRole("button", { name: label }))
        await waitFor(() => expect(doContractBroadcast).toHaveBeenCalledTimes(1))
        expect(lastSigned().msg).toMatchObject({ caller, pkg_path: ESCROW, func, args: [...args], send: "" })
    })

    it("a party's actions are not offered to someone else", async () => {
        chain.contract = contract({ expireAt: null, milestones: [ms(0, "funded")] })
        await show(STRANGER)
        expect(screen.queryByRole("button", { name: /mark delivered|release|dispute|cancel|fund/i })).not.toBeInTheDocument()
    })

    it("when the outcome is unknown, offers no call until the contract is read again", async () => {
        doContractBroadcast.mockRejectedValueOnce(new Error("Request timed out"))
        await show(CLIENT)
        fireEvent.click(within(screen.getByTestId("escrow-fund-0")).getByRole("button"))
        const alert = await screen.findByRole("alert")
        expect(alert).toHaveTextContent(/Request timed out.*Check the contract before retrying/)
        expect(within(screen.getByTestId("escrow-fund-0")).getByRole("button")).toBeDisabled()
        expect(within(screen.getByTestId("escrow-fund-1")).getByRole("button")).toBeDisabled()
        expect(doContractBroadcast).toHaveBeenCalledTimes(1)
        fireEvent.click(screen.getByRole("button", { name: "Reload contract" }))
        await waitFor(() => expect(within(screen.getByTestId("escrow-fund-0")).getByRole("button")).toBeEnabled())
        expect(readEscrowContract).toHaveBeenCalledTimes(2)
    })

    it("after a failure that certainly did not land, the call stays available", async () => {
        doContractBroadcast.mockRejectedValueOnce(new Error("Transaction cancelled by user"))
        await show(CLIENT)
        fireEvent.click(within(screen.getByTestId("escrow-fund-0")).getByRole("button"))
        expect(await screen.findByRole("alert")).toHaveTextContent("Transaction cancelled by user")
        expect(screen.getByRole("alert")).not.toHaveTextContent(/Check the contract/)
        expect(within(screen.getByTestId("escrow-fund-0")).getByRole("button")).toBeEnabled()
    })

    it("while paused, funding is refused and other calls wait for the blocking window", async () => {
        chain.pause = { paused: true, exitsOpen: false, exitsReopenAt: 2_100_000, pausedBlocks: 5 }
        await show(CLIENT)
        expect(screen.getByTestId("escrow-pause-note")).toHaveTextContent(/reopens at block 2,100,000/)
        expect(within(screen.getByTestId("escrow-fund-0")).getByRole("button")).toBeDisabled()
        expect(screen.getByTestId("escrow-fund-0")).toHaveTextContent("Escrow is paused: funding is refused until it is unpaused.")
        expect(within(screen.getByTestId("escrow-cancel")).getByRole("button")).toBeDisabled()
    })

    it("once the blocking window ends, only funding stays refused", async () => {
        chain.pause = { paused: true, exitsOpen: true, exitsReopenAt: 1_900_000, pausedBlocks: 183_273 }
        await show(CLIENT)
        expect(screen.getByTestId("escrow-pause-note")).toHaveTextContent(/new contracts and funding are refused/)
        expect(within(screen.getByTestId("escrow-fund-0")).getByRole("button")).toBeDisabled()
        expect(within(screen.getByTestId("escrow-cancel")).getByRole("button")).toBeEnabled()
    })

    it("never broadcasts while the services lane is gated", async () => {
        await show(CLIENT)
        gate.live = false
        fireEvent.click(within(screen.getByTestId("escrow-fund-0")).getByRole("button"))
        expect(await screen.findByRole("alert")).toHaveTextContent(/not available/)
        expect(doContractBroadcast).not.toHaveBeenCalled()
    })
})

describe("EscrowContractDetail — switching contracts", () => {
    it("drops the previous contract and its calls as soon as the id changes", async () => {
        // Plain render: its rerender updates props in place (renderWithProviders' would remount the tree).
        const { rerender } = render(<EscrowContractDetail id="7" caller={CLIENT} />)
        await screen.findByTestId("escrow-fund-0")
        let answer: (c: EscrowContractView) => void = () => {}
        readEscrowContract.mockImplementationOnce(() => new Promise<EscrowContractView>((resolve) => { answer = resolve }))
        rerender(<EscrowContractDetail id="8" caller={CLIENT} />)
        // While contract 8 is being read, nothing of contract 7 can be signed.
        expect(screen.queryByTestId("escrow-contract-details")).not.toBeInTheDocument()
        expect(screen.queryByRole("button", { name: /Fund milestone/ })).not.toBeInTheDocument()
        expect(screen.getByText("Loading contract 8...")).toBeInTheDocument()
        answer(contract({ id: "8", title: "Other", milestones: [ms(0, "completed")], expireAt: null }))
        expect(await screen.findByRole("button", { name: "Release payment" })).toBeEnabled()
        expect(screen.getByText("Other")).toBeInTheDocument()
    })
})
