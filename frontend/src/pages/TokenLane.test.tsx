import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

const net = vi.hoisted(() => ({ key: "mainnet" }))
vi.mock("../lib/config", async (orig) => ({
    ...(await orig<typeof import("../lib/config")>()),
    get ACTIVE_NETWORK_KEY() { return net.key },
}))
vi.mock("../lib/tokenOtcApi", () => ({ fetchOtcListings: vi.fn(async () => []) }))
vi.mock("../hooks/useAuth", () => ({ useAuth: () => ({ address: "g1seller" }) }))
vi.mock("../components/nft/TokenTradeModal", () => ({
    TokenTradeModal: ({ symbol, action }: { symbol: string; action: string }) => (
        <div data-testid="trade-modal">{action} {symbol}</div>
    ),
}))

import { TokenLane } from "./TokenLane"

function renderLane() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return render(<QueryClientProvider client={client}><TokenLane /></QueryClientProvider>)
}

describe("TokenLane — List Tokens symbol", () => {
    it("defaults to MEMBA, not the testnet MEMBATEST, off test chains", async () => {
        net.key = "mainnet"
        renderLane()
        expect(await screen.findByLabelText("Token symbol to list")).toHaveValue("MEMBA")
        fireEvent.click(screen.getByRole("button", { name: "List Tokens" }))
        expect(screen.getByTestId("trade-modal")).toHaveTextContent("list MEMBA")
    })

    it("defaults to MEMBATEST on a test chain", async () => {
        net.key = "test13"
        renderLane()
        expect(await screen.findByLabelText("Token symbol to list")).toHaveValue("MEMBATEST")
    })

    it("lists the token the seller chooses", async () => {
        renderLane()
        fireEvent.change(await screen.findByLabelText("Token symbol to list"), { target: { value: "forge" } })
        fireEvent.click(screen.getByRole("button", { name: "List Tokens" }))
        expect(screen.getByTestId("trade-modal")).toHaveTextContent("list FORGE")
    })

    it("cannot open the listing without a symbol", async () => {
        renderLane()
        fireEvent.change(await screen.findByLabelText("Token symbol to list"), { target: { value: "" } })
        expect(screen.getByRole("button", { name: "List Tokens" })).toBeDisabled()
    })
})
