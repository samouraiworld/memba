import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { SignRequest } from "../../sign/signer"

const chain = vi.hoisted(() => ({ gateOpen: true, raiseCap: "9223372036854775807", reserved: false }))
const queryEval = vi.hoisted(() => vi.fn())
const sign = vi.hoisted(() => vi.fn(() => true))
vi.mock("../../../lib/dao/shared", async (original) => ({ ...(await original<typeof import("../../../lib/dao/shared")>()), queryEval }))
vi.mock("../../../lib/config", async (original) => ({
    ...(await original<typeof import("../../../lib/config")>()),
    ACTIVE_NETWORK_KEY: "mainnet", currentNetworkKey: () => "mainnet", isRealmValidOn: () => true,
}))
vi.mock("../../../lib/grc20", async (original) => ({ ...(await original<typeof import("../../../lib/grc20")>()), networkGasPriceFresh: async () => ({ gas: 1000, ugnot: 1 }) }))
vi.mock("../../sign/signerContext", () => ({ useSigner: () => ({ sign }) }))

import CreateFairSale from "./CreateFairSale"

const ME = "g136j0m08pkm2lwwde9dmlx8uee26llent9s5cpf"
const qjson = (value: unknown) => `(${JSON.stringify(JSON.stringify(value))} string)`

function answer(_rpc: string, _path: string, expression: string) {
    if (expression === 'TermsJSON("ugnot")') return qjson({ schema: "launchpad-sales-terms-v1", version: "4", currency: "ugnot", directCreationFee: "1000000", fairSaleCreationFee: "2000000", fairSaleRaiseCap: chain.raiseCap, primaryFeeBps: "200" })
    if (expression === 'ActionStatusJSON("fairsale", "ugnot")') return qjson({ schema: "launchpad-config-action-v1", lane: "fairsale", currency: "ugnot", version: "4", paused: !chain.gateOpen, allowlisted: true, laneReady: true, configGateOpen: chain.gateOpen })
    if (expression === 'IsReserved("REHB")') return `(${chain.reserved} bool)`
    throw new Error(`unexpected read ${expression}`)
}

function show(member: boolean) {
    const session = { status: member ? "member" : "guest", address: member ? ME : "", openConnect: vi.fn() }
    const props = { onClose: vi.fn(), onCreated: vi.fn() }
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={client}><CreateFairSale network="mainnet" session={session as never} {...props} /></QueryClientProvider>)
    return { session, ...props }
}
const type = (label: string | RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } })
const next = () => fireEvent.click(screen.getByRole("button", { name: "Continue" }))

function fillToken() {
    type("Name", "Rehearsal Sale")
    type("Ticker", "rehb")
    type("Supply", "1000000")
    next()
}
function fillSale() {
    type("Lot size", "1000")
    type("Lots on offer", "600")
    type("Lots per wallet", "300")
    type("Price per lot (GNOT)", "0.5")
    type("Soft cap (GNOT)", "200")
}

beforeEach(() => {
    chain.gateOpen = true; chain.raiseCap = "9223372036854775807"; chain.reserved = false
    queryEval.mockReset(); queryEval.mockImplementation(async (...args: [string, string, string]) => answer(...args))
    sign.mockClear()
})

describe("Open a fair sale", () => {
    it("lets a guest fill every step and asks to connect only to sign", async () => {
        const { session } = show(false)
        fillToken()
        expect(screen.getByRole("heading", { name: "Sale" })).toBeInTheDocument()
        fillSale()
        expect(screen.getByText("On sale: 600000 REHB; to you now: 400000 REHB.")).toBeInTheDocument()
        next()
        expect(await screen.findByText("2 GNOT")).toBeInTheDocument()
        expect(screen.getByText("600 lots of 1000 REHB, at most 300 per wallet")).toBeInTheDocument()
        expect(screen.getByText("2% of what the sale raises")).toBeInTheDocument()
        fireEvent.click(screen.getByRole("button", { name: "Connect to open the sale" }))
        expect(session.openConnect).toHaveBeenCalled()
        expect(sign).not.toHaveBeenCalled()
    })

    it("stops at the step whose fields break a rule", () => {
        show(false)
        next()
        expect(screen.getByRole("alert")).toHaveTextContent("Enter the supply as a number of tokens.")
        type("Supply", "100")
        type("Name", "Fine")
        type("Ticker", "OK")
        next()
        fillSale()
        next()
        expect(screen.getByRole("alert")).toHaveTextContent("The lots on offer exceed the supply.")
        expect(screen.getByRole("heading", { name: "Sale" })).toBeInTheDocument()
        type("Lot size", "1")
        type("Lots on offer", "50")
        type("Lots per wallet", "10")
        type("Soft cap (GNOT)", "26")
        next()
        expect(screen.getByRole("alert")).toHaveTextContent("reachable")
    })

    it("asks for the floor, the step and its period only for a falling price", async () => {
        show(false)
        fillToken()
        expect(screen.queryByLabelText("Floor price per lot (GNOT)")).not.toBeInTheDocument()
        fireEvent.click(screen.getByRole("button", { name: "Falling" }))
        type("Lot size", "1000")
        type("Lots on offer", "600")
        type("Lots per wallet", "300")
        type("Soft cap (GNOT)", "200")
        type("Start price per lot (GNOT)", "0.5")
        type("Floor price per lot (GNOT)", "0.1")
        next()
        expect(screen.getByRole("alert")).toHaveTextContent("Enter prices and the soft cap in GNOT")
        type("Price step (GNOT)", "0.05")
        next()
        expect(await screen.findByText("0.5 GNOT, falling 0.05 GNOT every 60 min to 0.1 GNOT")).toBeInTheDocument()
    })

    it("hands a member's sale to the signer, and reports the outcome", async () => {
        const { onCreated, onClose } = show(true)
        fillToken()
        fillSale()
        next()
        fireEvent.click(await screen.findByRole("button", { name: "Review and sign" }))
        await vi.waitFor(() => expect(sign).toHaveBeenCalled())
        const request = (sign.mock.calls[0] as unknown as [SignRequest])[0]
        const value = request.prepare(undefined).msgs[0].value as { func: string; send: string; caller: string; args: string[] }
        expect(value).toMatchObject({ func: "CreateFairSale", send: "2000000ugnot", caller: ME })
        expect(value.args.slice(0, 11)).toEqual(["Rehearsal Sale", "REHB", "6", "1000000000000", "600000000000", "1000000000", "600", "300", "200000000", "ugnot", "4"])
        expect(BigInt(value.args[12]) - BigInt(value.args[11])).toBe(24n * 3600n)
        expect(value.args.slice(13, 17)).toEqual(["500000", "500000", "0", "60"])
        act(() => request.onSettled!("confirmed", undefined))
        expect(screen.getByRole("status")).toHaveTextContent("The REHB sale is open for orders from its start time.")
        fireEvent.click(screen.getByRole("button", { name: "Back to tokens" }))
        expect(onCreated).toHaveBeenCalled()
        expect(onClose).toHaveBeenCalled()
    })

    it("offers no signature while the Launchpad opens no sales, or when the terms' cap refuses the sale", async () => {
        chain.gateOpen = false
        show(true)
        fillToken()
        fillSale()
        next()
        expect(await screen.findByText("The Launchpad is not opening new sales right now.")).toBeInTheDocument()
        expect(screen.getByRole("button", { name: "Review and sign" })).toBeDisabled()
    })

    it("names a raise cap the sale exceeds at review", async () => {
        chain.raiseCap = "1000000"
        show(true)
        fillToken()
        fillSale()
        next()
        expect(await screen.findByText("The lots on offer at the start price exceed what one sale may raise.")).toBeInTheDocument()
        expect(screen.getByRole("button", { name: "Review and sign" })).toBeDisabled()
    })

    it("names a reserved ticker at review, and tells the creator when the money moves", async () => {
        chain.reserved = true
        show(true)
        fillToken()
        fillSale()
        next()
        expect(await screen.findByText("REHB is reserved on the Launchpad; choose another ticker.")).toBeInTheDocument()
        expect(screen.getByText(/creates no trading market or liquidity/)).toBeInTheDocument()
        expect(screen.getByRole("button", { name: "Review and sign" })).toBeDisabled()
    })

    it("words a refused sale truthfully", async () => {
        show(true)
        fillToken()
        fillSale()
        next()
        fireEvent.click(await screen.findByRole("button", { name: "Review and sign" }))
        await vi.waitFor(() => expect(sign).toHaveBeenCalled())
        act(() => (sign.mock.calls[0] as unknown as [SignRequest])[0].onSettled!("failed", undefined))
        expect(screen.getByRole("alert")).toHaveTextContent("The network refused the sale; the creation fee was not taken. The notification says why.")
    })
})
