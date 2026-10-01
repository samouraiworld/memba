import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { SignRequest } from "../../sign/signer"

const chain = vi.hoisted(() => ({ gateOpen: true, count: "6" }))
const queryEval = vi.hoisted(() => vi.fn())
const sign = vi.hoisted(() => vi.fn(() => true))
vi.mock("../../../lib/dao/shared", async (original) => ({ ...(await original<typeof import("../../../lib/dao/shared")>()), queryEval }))
vi.mock("../../../lib/config", async (original) => ({
    ...(await original<typeof import("../../../lib/config")>()),
    ACTIVE_NETWORK_KEY: "mainnet", currentNetworkKey: () => "mainnet", isRealmValidOn: () => true,
}))
vi.mock("../../../lib/grc20", async (original) => ({ ...(await original<typeof import("../../../lib/grc20")>()), networkGasPriceFresh: async () => ({ gas: 1000, ugnot: 1 }) }))
vi.mock("../../sign/signerContext", () => ({ useSigner: () => ({ sign }) }))

import CreateToken from "./CreateToken"

const A = "g1x7k4628w93a7wzdhqc06atzx0v50rnshweuxu0"
const B = "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5"
const ME = "g136j0m08pkm2lwwde9dmlx8uee26llent9s5cpf"
const qjson = (value: unknown) => `(${JSON.stringify(JSON.stringify(value))} string)`

function answer(_rpc: string, _path: string, expression: string) {
    if (expression === 'TermsJSON("ugnot")') return qjson({ schema: "launchpad-sales-terms-v1", version: "4", currency: "ugnot", directCreationFee: "1000000", fairSaleCreationFee: "2000000", fairSaleRaiseCap: "1000000000", primaryFeeBps: "200" })
    const lane = expression.match(/^ActionStatusJSON\("(\w+)", "ugnot"\)$/)?.[1]
    if (lane) return qjson({ schema: "launchpad-config-action-v1", lane, currency: "ugnot", version: "4", paused: !chain.gateOpen, allowlisted: true, laneReady: true, configGateOpen: chain.gateOpen })
    if (expression === "Count()") return `(${chain.count} int64)`
    if (expression.startsWith("IsReserved(")) return "(false bool)"
    throw new Error(`unexpected read ${expression}`)
}

function show(member: boolean) {
    const session = { status: member ? "member" : "guest", address: member ? ME : "", openConnect: vi.fn() }
    const props = { onClose: vi.fn(), onCreated: vi.fn() }
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={client}><CreateToken network="mainnet" session={session as never} {...props} /></QueryClientProvider>)
    return { session, ...props }
}
const type = (label: string | RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } })
const next = () => fireEvent.click(screen.getByRole("button", { name: "Continue" }))

function fillToken() {
    type("Name", "Rehearsal Token")
    type("Ticker", "reha")
    type("Initial supply", "1000")
    next()
}

beforeEach(() => {
    chain.gateOpen = true; chain.count = "6"
    queryEval.mockReset(); queryEval.mockImplementation(async (...args: [string, string, string]) => answer(...args))
    sign.mockClear()
})

describe("Create a token", () => {
    it("lets a guest fill every step and asks to connect only to sign", async () => {
        const { session } = show(false)
        fillToken()
        expect(screen.getByRole("heading", { name: "Distribution" })).toBeInTheDocument()
        fireEvent.click(screen.getByRole("button", { name: "+ Add allocation" }))
        type("Allocation 1 address", A)
        type("Allocation 1 amount", "100")
        type("Allocation 1 vesting days", "30")
        expect(screen.getByText("To you: 900 REHA")).toBeInTheDocument()
        next()
        type("Recipients", `${A} 10\n${B} 5`)
        expect(screen.getByText("2 recipients, 15 REHA.")).toBeInTheDocument()
        next()
        expect(await screen.findByText("1 GNOT")).toBeInTheDocument()
        expect(screen.getByText("15 REHA to 2 recipients, for token T7")).toBeInTheDocument()
        expect(screen.getByText("885 REHA")).toBeInTheDocument()
        fireEvent.click(screen.getByRole("button", { name: "Connect to create" }))
        expect(session.openConnect).toHaveBeenCalled()
        expect(sign).not.toHaveBeenCalled()
    })

    it("stops at the step whose fields break a rule", () => {
        show(false)
        next()
        expect(screen.getByRole("alert")).toHaveTextContent("Enter the initial supply as a number of tokens.")
        type("Initial supply", "10")
        type("Name", " Spaced")
        next()
        expect(screen.getByRole("alert")).toHaveTextContent("The name needs 1 to 32 bytes")
        expect(screen.getByLabelText("Name")).toBeInTheDocument()
        type("Name", "Fine")
        type("Ticker", "OK")
        next()
        fireEvent.click(screen.getByRole("button", { name: "+ Add allocation" }))
        type("Allocation 1 address", A.toUpperCase())
        type("Allocation 1 amount", "1")
        next()
        expect(screen.getByRole("alert")).toHaveTextContent("is not an address that can receive tokens")
        expect(screen.getByRole("heading", { name: "Distribution" })).toBeInTheDocument()
    })

    it("hands a member's creation to the signer, and reports the outcome", async () => {
        const { onCreated, onClose } = show(true)
        fillToken()
        next()
        next()
        fireEvent.click(await screen.findByRole("button", { name: "Review and sign" }))
        await vi.waitFor(() => expect(sign).toHaveBeenCalled())
        const request = (sign.mock.calls[0] as unknown as [SignRequest])[0]
        const value = request.prepare(undefined).msgs[0].value as { func: string; send: string; caller: string; args: string[] }
        expect(value).toMatchObject({ func: "CreateDirect", send: "1000000ugnot", caller: ME })
        expect(value.args).toEqual(["direct_fixed", "Rehearsal Token", "REHA", "6", "1000000000", "1000000000", "ugnot", "4", "", "", "", "", "", ""])
        act(() => request.onSettled!("confirmed", undefined))
        expect(screen.getByRole("status")).toHaveTextContent("Rehearsal Token (REHA) is created.")
        fireEvent.click(screen.getByRole("button", { name: "Back to tokens" }))
        expect(onCreated).toHaveBeenCalled()
        expect(onClose).toHaveBeenCalled()
    })

    it("says so, and offers no signature, while the Launchpad takes no new tokens", async () => {
        chain.gateOpen = false
        show(true)
        fillToken()
        next()
        next()
        expect(await screen.findByText("The Launchpad is not taking new tokens right now.")).toBeInTheDocument()
        expect(screen.getByRole("button", { name: "Review and sign" })).toBeDisabled()
    })

    it("waits for the manifest to be saved, signs that very root, and shows it again once created", async () => {
        const writeText = vi.fn(async () => {})
        Object.assign(navigator, { clipboard: { writeText } })
        show(true)
        fillToken()
        next()
        type("Recipients", `${A} 10\n${B} 5`)
        next()
        const sign_ = await screen.findByRole("button", { name: "Review and sign" })
        expect(sign_).toBeDisabled()
        expect(screen.getByText("Copy or download the manifest first: signing waits for it.")).toBeInTheDocument()
        expect(screen.getByText(/if it is lost, the airdropped 15 REHA can never be claimed/)).toBeInTheDocument()
        fireEvent.click(screen.getByRole("button", { name: "Copy the manifest" }))
        await vi.waitFor(() => expect(sign_).toBeEnabled())
        const copied = JSON.parse((writeText.mock.calls[0] as unknown as [string])[0])
        expect(copied).toMatchObject({ tokenId: "T7", total: "15000000" })
        fireEvent.click(sign_)
        await vi.waitFor(() => expect(sign).toHaveBeenCalled())
        const request = (sign.mock.calls[0] as unknown as [SignRequest])[0]
        const args = (request.prepare(undefined).msgs[0].value as { args: string[] }).args
        expect(args.slice(-3)).toEqual(["T7", copied.root, "15000000"])
        act(() => request.onSettled!("confirmed", undefined))
        expect(screen.getByRole("status")).toHaveTextContent("Rehearsal Token (REHA) is created as T7.")
        expect(screen.getByText(`Token T7 · root ${copied.root}`)).toBeInTheDocument()
        expect(screen.getByRole("button", { name: "Download the manifest" })).toBeInTheDocument()
    })

    it("asks for the manifest again when another token takes the expected ID", async () => {
        Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => {}) } })
        show(true)
        fillToken()
        next()
        type("Recipients", `${A} 10`)
        next()
        fireEvent.click(await screen.findByRole("button", { name: "Copy the manifest" }))
        const sign_ = screen.getByRole("button", { name: "Review and sign" })
        await vi.waitFor(() => expect(sign_).toBeEnabled())
        fireEvent.click(sign_)
        await vi.waitFor(() => expect(sign).toHaveBeenCalled())
        const request = (sign.mock.calls[0] as unknown as [SignRequest])[0]
        chain.count = "7"
        await expect(request.recheck!(undefined)).rejects.toThrow("Another token was created first")
        expect(await screen.findByText(/Token T8 · root/)).toBeInTheDocument()
        expect(screen.getByRole("button", { name: "Copy the manifest" })).toBeInTheDocument()
        expect(screen.getByRole("button", { name: "Review and sign" })).toBeDisabled()
    })

    it("downloads the manifest as a file", async () => {
        const createObjectURL = vi.fn(() => "blob:manifest")
        Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() })
        const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {})
        show(true)
        fillToken()
        next()
        type("Recipients", `${A} 10`)
        next()
        fireEvent.click(await screen.findByRole("button", { name: "Download the manifest" }))
        expect(click).toHaveBeenCalled()
        expect(createObjectURL).toHaveBeenCalled()
        expect(screen.getByRole("button", { name: "Review and sign" })).toBeEnabled()
        click.mockRestore()
    })

    it("words a refused creation truthfully", async () => {
        show(true)
        fillToken()
        next()
        next()
        fireEvent.click(await screen.findByRole("button", { name: "Review and sign" }))
        await vi.waitFor(() => expect(sign).toHaveBeenCalled())
        act(() => (sign.mock.calls[0] as unknown as [SignRequest])[0].onSettled!("failed", undefined))
        expect(screen.getByRole("alert")).toHaveTextContent("The network refused the creation; the creation fee was not taken. The notification says why.")
    })

})
