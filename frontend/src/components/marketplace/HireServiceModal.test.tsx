/**
 * HireServiceModal.test.tsx — the hire flow signs exactly the CreateContract it shows.
 *
 * W0.2 made this flow fail closed while it targeted the non-deployable
 * `memba_escrow_v1`. It now builds a CreateContract plan for escrow_v3 (sized
 * storage-deposit cap and gas limit), and still refuses to broadcast unless the
 * services lane is live on this network (VITE_ENABLE_SERVICES && isEscrowValid()).
 */
import { screen, fireEvent, waitFor } from "@testing-library/react"
import { beforeEach, describe, it, expect, vi } from "vitest"
import { renderWithProviders } from "../../test/test-utils"
import { HireServiceModal, type Service } from "./HireServiceModal"
import { planHireService } from "../../lib/marketplace/escrowTx"

const gate = vi.hoisted(() => ({ services: false, escrow: false }))
vi.mock("../../lib/config", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../lib/config")>()),
    isServicesEnabled: () => gate.services,
    isEscrowValid: () => gate.escrow,
}))

const doContractBroadcast = vi.hoisted(() => vi.fn(async () => ({ hash: "TX" })))
vi.mock("../../lib/grc20", async (importOriginal) => ({ ...(await importOriginal<typeof import("../../lib/grc20")>()), doContractBroadcast }))

const CLIENT = "g1747t5m2f08plqjlrjk2q0qld7465hxz8gkx59c"
const FREELANCER = "g1u7y667z64x2h7vc6fmpcprgey4ck233jaww9zq"
const ESCROW = "gno.land/r/samcrew/escrow_v3"

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

beforeEach(() => {
    gate.services = false
    gate.escrow = false
    doContractBroadcast.mockClear()
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

    it("fails closed when escrow_v3 is not listed for this network: no broadcast", async () => {
        gate.services = true
        const { sign } = open()
        fireEvent.click(sign())
        expect(await screen.findByText(/not available/i)).toBeInTheDocument()
        expect(doContractBroadcast).not.toHaveBeenCalled()
    })
})

describe("HireServiceModal — live", () => {
    beforeEach(() => {
        gate.services = true
        gate.escrow = true
    })

    it("previews the exact milestones, that nothing is sent now, and the storage-deposit cap", () => {
        open()
        const plan = planHireService(CLIENT, ESCROW, service)
        expect(screen.getByText("Deposit — 250 GNOT")).toBeInTheDocument()
        expect(screen.getByText("Final — 250 GNOT")).toBeInTheDocument()
        expect(screen.getByText("500 GNOT")).toBeInTheDocument()
        expect(screen.getByText(/nothing is sent/i)).toBeInTheDocument()
        expect(screen.getByTestId("hire-deposit-cap")).toHaveTextContent(`${plan.maxDepositUgnot / 1_000_000} GNOT`)
    })

    it("signs the previewed CreateContract with its deposit cap and gas limit", async () => {
        const { onSuccess, sign } = open()
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

    it("shows the wallet error and stays open when signing fails", async () => {
        doContractBroadcast.mockRejectedValueOnce(new Error("Transaction cancelled by user"))
        const { onSuccess, sign } = open()
        fireEvent.click(sign())
        expect(await screen.findByText(/cancelled by user/i)).toBeInTheDocument()
        expect(onSuccess).not.toHaveBeenCalled()
    })
})
