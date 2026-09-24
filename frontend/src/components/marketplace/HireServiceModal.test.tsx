/**
 * HireServiceModal.test.tsx — the hire flow signs exactly the CreateContract it shows.
 *
 * W0.2 made this flow fail closed while it targeted the non-deployable
 * `memba_escrow_v1`. It now builds a CreateContract plan for escrow_v4 (sized
 * storage-deposit cap and gas limit), and still refuses to broadcast unless the
 * services lane is live on this network (VITE_ENABLE_SERVICES && isEscrowValid()).
 * When the lane is live it first reads the realm's pause state and the caller's
 * open contracts, and does not offer to sign a CreateContract the realm would refuse.
 */
import { screen, fireEvent, waitFor } from "@testing-library/react"
import { beforeEach, describe, it, expect, vi } from "vitest"
import { renderWithProviders } from "../../test/test-utils"
import { HireServiceModal, type Service } from "./HireServiceModal"
import { planHireService } from "../../lib/marketplace/escrowTx"
import { formatUgnotExact } from "../../lib/dao/v2Budget"

const gate = vi.hoisted(() => ({ services: false, escrow: false }))
vi.mock("../../lib/config", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../lib/config")>()),
    isServicesEnabled: () => gate.services,
    isEscrowValid: () => gate.escrow,
}))

const doContractBroadcast = vi.hoisted(() => vi.fn(async () => ({ hash: "TX" })))
vi.mock("../../lib/grc20", async (importOriginal) => ({ ...(await importOriginal<typeof import("../../lib/grc20")>()), doContractBroadcast }))

const chain = vi.hoisted(() => ({
    pause: { paused: false, exitsOpen: true, exitsReopenAt: 0, pausedBlocks: 0 },
    active: 0,
    height: 1_000_000,
    fail: null as Error | null,
}))
const readEscrowPauseState = vi.hoisted(() => vi.fn(async () => { if (chain.fail) throw chain.fail; return chain.pause }))
const readClientActiveCount = vi.hoisted(() => vi.fn(async () => chain.active))
const findCreatedContract = vi.hoisted(() => vi.fn<() => Promise<string | null>>(async () => "12"))
vi.mock("../../lib/marketplace/escrowState", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../lib/marketplace/escrowState")>()),
    readEscrowPauseState,
    readClientActiveCount,
    findCreatedContract,
}))
vi.mock("../../lib/dao/proposalDates", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../lib/dao/proposalDates")>()),
    getCurrentBlock: async () => chain.height,
}))

const CLIENT = "g1747t5m2f08plqjlrjk2q0qld7465hxz8gkx59c"
const FREELANCER = "g1u7y667z64x2h7vc6fmpcprgey4ck233jaww9zq"
const ESCROW = "gno.land/r/samcrew/escrow_v4"

const service: Service = {
    id: "svc-1",
    title: "Smart Contract Audit",
    freelancer: FREELANCER,
    description: "audit",
    priceUgnot: 500_000_000,
    milestones: "Deposit:250000000,Final:250000000",
    category: "Security",
    image: "🛡️",
}

const open = (svc: Service = service, caller = CLIENT) => {
    const onSuccess = vi.fn()
    renderWithProviders(<HireServiceModal service={svc} caller={caller} onClose={vi.fn()} onSuccess={onSuccess} />)
    return { onSuccess, sign: () => screen.getByRole("button", { name: /sign escrow tx/i }) }
}

/** Open, then wait until the pause and cap reads have settled. */
const openReady = async (svc: Service = service, caller = CLIENT) => {
    const opened = open(svc, caller)
    await waitFor(() => expect(screen.queryByTestId("hire-preflight-loading")).not.toBeInTheDocument())
    return opened
}

beforeEach(() => {
    gate.services = false
    gate.escrow = false
    chain.pause = { paused: false, exitsOpen: true, exitsReopenAt: 0, pausedBlocks: 0 }
    chain.active = 0
    chain.height = 1_000_000
    chain.fail = null
    doContractBroadcast.mockClear()
    readEscrowPauseState.mockClear()
    readClientActiveCount.mockClear()
    findCreatedContract.mockReset()
    findCreatedContract.mockResolvedValue("12")
})

describe("HireServiceModal — gated", () => {
    it("fails closed when the services lane is off: no broadcast", async () => {
        gate.escrow = true
        const { onSuccess, sign } = open()
        fireEvent.click(sign())
        expect(await screen.findByText(/not available/i)).toBeInTheDocument()
        expect(doContractBroadcast).not.toHaveBeenCalled()
        expect(onSuccess).not.toHaveBeenCalled()
    })

    it("fails closed when escrow_v4 is not listed for this network: no broadcast", async () => {
        gate.services = true
        const { sign } = open()
        fireEvent.click(sign())
        expect(await screen.findByText(/not available/i)).toBeInTheDocument()
        expect(doContractBroadcast).not.toHaveBeenCalled()
    })

    it("reads nothing from the realm while the lane is gated", () => {
        open()
        expect(readEscrowPauseState).not.toHaveBeenCalled()
        expect(readClientActiveCount).not.toHaveBeenCalled()
    })
})

describe("HireServiceModal — live", () => {
    beforeEach(() => {
        gate.services = true
        gate.escrow = true
    })

    it("previews the exact milestones, that nothing is sent now, and the storage-deposit cap", async () => {
        await openReady()
        const plan = planHireService(CLIENT, ESCROW, service)
        expect(screen.getByText("Deposit — 250 GNOT")).toBeInTheDocument()
        expect(screen.getByText("Final — 250 GNOT")).toBeInTheDocument()
        expect(screen.getByText("500 GNOT")).toBeInTheDocument()
        expect(screen.getByText(/nothing is sent/i)).toBeInTheDocument()
        expect(screen.getByTestId("hire-deposit-cap")).toHaveTextContent(`${plan.maxDepositUgnot / 1_000_000} GNOT`)
    })

    it("signs the previewed CreateContract with its deposit cap and gas limit", async () => {
        const { onSuccess, sign } = await openReady()
        fireEvent.click(sign())
        await waitFor(() => expect(onSuccess).toHaveBeenCalled())
        const plan = planHireService(CLIENT, ESCROW, service)
        expect(doContractBroadcast).toHaveBeenCalledTimes(1)
        const [msgs, , opts] = doContractBroadcast.mock.calls[0] as unknown as [unknown[], string, Record<string, unknown>]
        expect(msgs).toEqual([plan.msg])
        expect(plan.msg.value).toMatchObject({
            caller: CLIENT,
            send: "",
            pkg_path: ESCROW,
            func: "CreateContract",
            args: [FREELANCER, "Smart Contract Audit", "audit", "Deposit:250000000,Final:250000000"],
        })
        expect(opts).toMatchObject({ gasWanted: plan.gasWanted, retry: false })
    })

    it("reads the new contract's id back after it lands and hands it over", async () => {
        const { onSuccess, sign } = await openReady()
        fireEvent.click(sign())
        await waitFor(() => expect(onSuccess).toHaveBeenCalledWith("12"))
        expect(findCreatedContract).toHaveBeenCalledWith(ESCROW, CLIENT, {
            freelancer: FREELANCER,
            title: "Smart Contract Audit",
            description: "audit",
            milestones: [{ title: "Deposit", amountUgnot: 250_000_000 }, { title: "Final", amountUgnot: 250_000_000 }],
        })
    })

    it("still reports success, without an id, when the new contract cannot be read back", async () => {
        findCreatedContract.mockRejectedValueOnce(new Error("Could not read your escrow contracts"))
        const { onSuccess, sign } = await openReady()
        fireEvent.click(sign())
        await waitFor(() => expect(onSuccess).toHaveBeenCalledWith(null))
        expect(doContractBroadcast).toHaveBeenCalledTimes(1)
    })

    it("does not look for a contract after a failed broadcast", async () => {
        doContractBroadcast.mockRejectedValueOnce(new Error("Transaction cancelled by user"))
        const { sign } = await openReady()
        fireEvent.click(sign())
        await screen.findByText(/cancelled by user/i)
        expect(findCreatedContract).not.toHaveBeenCalled()
    })

    it("refuses milestones the realm would reject or reinterpret: no broadcast", async () => {
        const { sign } = open({ ...service, milestones: "Deposit:2.5,Final:250000000" })
        expect(screen.getByRole("alert")).toHaveTextContent(/amount/i)
        expect(sign()).toBeDisabled()
        fireEvent.click(sign())
        expect(doContractBroadcast).not.toHaveBeenCalled()
    })

    it("refuses to hire yourself: no broadcast", () => {
        const { sign } = open(service, FREELANCER)
        expect(screen.getByRole("alert")).toHaveTextContent(/yourself/i)
        expect(sign()).toBeDisabled()
    })

    it("asks for a wallet when there is no caller: no broadcast", () => {
        const { sign } = open(service, "")
        expect(screen.getByRole("alert")).toHaveTextContent(/connect/i)
        expect(sign()).toBeDisabled()
    })

    it("discloses that the storage deposit comes back on archive, to the client, with this contract's exact cap", async () => {
        await openReady()
        const plan = planHireService(CLIENT, ESCROW, service)
        expect(screen.getByTestId("hire-deposit-disclosure")).toHaveTextContent(
            `The storage deposit (up to ${formatUgnotExact(plan.maxDepositUgnot)}; the chain locks only what the contract uses) is refunded to you when you archive the contract after it is completed or cancelled.`,
        )
        expect(screen.queryByText(/not refunded/i)).not.toBeInTheDocument()
    })

    it("holds the sign button while it checks the realm's limits", () => {
        const { sign } = open()
        expect(screen.getByTestId("hire-preflight-loading")).toBeInTheDocument()
        expect(sign()).toBeDisabled()
    })

    it("reads the caller's open contracts and the pause state from the active escrow realm", async () => {
        await openReady()
        expect(readClientActiveCount).toHaveBeenCalledWith(ESCROW, CLIENT)
        expect(readEscrowPauseState).toHaveBeenCalledWith(ESCROW)
    })

    it("allows a client with 4 open contracts", async () => {
        chain.active = 4
        const { sign } = await openReady()
        expect(sign()).toBeEnabled()
    })

    it("disables Hire at the per-client cap of 5 open contracts, with the reason: no broadcast", async () => {
        chain.active = 5
        const { sign } = await openReady()
        expect(screen.getByRole("alert")).toHaveTextContent(/5 open escrow contracts, the most one client can hold \(5\)/)
        expect(sign()).toBeDisabled()
        fireEvent.click(sign())
        expect(doContractBroadcast).not.toHaveBeenCalled()
    })

    it("disables Hire while escrow is paused and says when other actions reopen", async () => {
        chain.pause = { paused: true, exitsOpen: false, exitsReopenAt: 1_183_273, pausedBlocks: 10 }
        const { sign } = await openReady()
        expect(screen.getByRole("alert")).toHaveTextContent(/paused: new contracts and funding are refused until it is unpaused/)
        expect(screen.getByRole("alert")).toHaveTextContent(/reopen at block 1,183,273 \(about 7 days\)/)
        expect(sign()).toBeDisabled()
    })

    it("still disables Hire after a pause's exits reopen: new money waits for Unpause", async () => {
        chain.pause = { paused: true, exitsOpen: true, exitsReopenAt: 1_183_273, pausedBlocks: 183_273 }
        chain.height = 1_200_000
        const { sign } = await openReady()
        expect(screen.getByRole("alert")).toHaveTextContent(/until it is unpaused/)
        expect(sign()).toBeDisabled()
    })

    it("fails closed when the limits cannot be read", async () => {
        chain.fail = new Error("Could not read the escrow pause state")
        const { sign } = await openReady()
        expect(screen.getByRole("alert")).toHaveTextContent(/Could not check the escrow contract's limits/)
        expect(sign()).toBeDisabled()
    })

    it("refuses text the realm would store differently: no broadcast", () => {
        const { sign } = open({ ...service, title: "Audit (v2)" })
        expect(screen.getByRole("alert")).toHaveTextContent(/strips/)
        expect(sign()).toBeDisabled()
    })

    it("offers a plain retry after a failure that certainly did not land", async () => {
        doContractBroadcast.mockRejectedValueOnce(new Error("Transaction cancelled by user"))
        const { onSuccess, sign } = await openReady()
        fireEvent.click(sign())
        expect(await screen.findByText(/cancelled by user/i)).toBeInTheDocument()
        expect(onSuccess).not.toHaveBeenCalled()
        expect(sign()).toBeEnabled()
        expect(screen.queryByRole("button", { name: /create anyway/i })).not.toBeInTheDocument()
    })

    it("after a failure that may have landed, asks to check contracts and needs an explicit create-anyway", async () => {
        doContractBroadcast.mockRejectedValueOnce(new Error("Request timed out"))
        const { onSuccess, sign } = await openReady()
        fireEvent.click(sign())
        expect(await screen.findByText(/could not confirm/i)).toBeInTheDocument()
        expect(onSuccess).not.toHaveBeenCalled()
        // No plain retry: the sign button is gone, the check link and a gated create-anyway replace it.
        expect(screen.queryByRole("button", { name: /sign escrow tx/i })).not.toBeInTheDocument()
        const link = screen.getByRole("link", { name: /check your escrow contracts/i })
        expect(link.getAttribute("href")).toContain("realm=r/samcrew/escrow_v4")
        const anyway = screen.getByRole("button", { name: /create anyway/i })
        expect(anyway).toBeDisabled()
        fireEvent.click(anyway)
        expect(doContractBroadcast).toHaveBeenCalledTimes(1)

        fireEvent.click(screen.getByRole("checkbox", { name: /no contract was created/i }))
        expect(anyway).toBeEnabled()
        fireEvent.click(anyway)
        await waitFor(() => expect(onSuccess).toHaveBeenCalled())
        expect(doContractBroadcast).toHaveBeenCalledTimes(2)
    })

    it("stays in the check-first state when create-anyway fails ambiguously again", async () => {
        doContractBroadcast.mockRejectedValueOnce(new Error("Failed to fetch")).mockRejectedValueOnce(new Error("Failed to fetch"))
        await openReady()
        fireEvent.click(screen.getByRole("button", { name: /sign escrow tx/i }))
        await screen.findByText(/could not confirm/i)
        fireEvent.click(screen.getByRole("checkbox", { name: /no contract was created/i }))
        fireEvent.click(screen.getByRole("button", { name: /create anyway/i }))
        await waitFor(() => expect(doContractBroadcast).toHaveBeenCalledTimes(2))
        expect(await screen.findByRole("button", { name: /create anyway/i })).toBeDisabled()
        expect(screen.getByRole("checkbox", { name: /no contract was created/i })).not.toBeChecked()
    })
})
