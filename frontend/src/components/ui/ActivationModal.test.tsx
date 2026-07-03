import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"

// W2.1: activation must ride the GUARDED broadcaster (RPC-trust, wrong-chain,
// A6 confirmation) — never window.adena directly.
const doContractBroadcast = vi.fn()
vi.mock("../../lib/grc20", () => ({
    doContractBroadcast: (...a: unknown[]) => doContractBroadcast(...a),
}))

import { ActivationModal } from "./ActivationModal"

describe("ActivationModal", () => {
    it("shows the faucet nudge if balance is 0", () => {
        render(
            <ActivationModal
                address="g1..."
                rawUgnot={0n}
                faucetUrl="https://faucet.gno.land"
                onSuccess={() => {}}
            />
        )
        expect(screen.getByText(/You need a tiny amount of GNOT to activate/i)).toBeInTheDocument()
        expect(screen.getByRole("link", { name: /Get GNOT from Faucet/i })).toHaveAttribute(
            "href",
            "https://faucet.gno.land"
        )
        expect(screen.queryByRole("button", { name: /Activate My Wallet/i })).not.toBeInTheDocument()
    })

    it("shows the activate button if balance > 0", () => {
        render(
            <ActivationModal
                address="g1..."
                rawUgnot={500000n}
                faucetUrl="https://faucet.gno.land"
                onSuccess={() => {}}
            />
        )
        expect(screen.queryByText(/You need a tiny amount of GNOT to activate/i)).not.toBeInTheDocument()
        expect(screen.getByRole("button", { name: /Activate My Wallet/i })).toBeInTheDocument()
    })

    it("activates through the guarded broadcaster, never window.adena directly (W2.1)", async () => {
        doContractBroadcast.mockResolvedValue({ hash: "abc" })
        const adenaMock = { DoContract: vi.fn() }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(window as any).adena = adenaMock

        const onSuccess = vi.fn()
        render(
            <ActivationModal
                address="g1abc"
                rawUgnot={500000n}
                faucetUrl="https://faucet.gno.land"
                onSuccess={onSuccess}
            />
        )

        fireEvent.click(screen.getByRole("button", { name: /Activate My Wallet/i }))

        await vi.waitFor(() => {
            expect(onSuccess).toHaveBeenCalled()
        })
        expect(doContractBroadcast).toHaveBeenCalledWith(
            [
                {
                    type: "bank/MsgSend",
                    value: {
                        from_address: "g1abc",
                        to_address: "g1abc",
                        amount: [{ denom: "ugnot", amount: "1" }],
                    },
                },
            ],
            "Memba Network Activation",
        )
        // The unguarded path must stay dead.
        expect(adenaMock.DoContract).not.toHaveBeenCalled()
    })

    it("surfaces a guard rejection instead of activating", async () => {
        doContractBroadcast.mockRejectedValueOnce(new Error("🛡️ Transaction blocked — wrong chain"))
        const onSuccess = vi.fn()
        render(
            <ActivationModal
                address="g1abc"
                rawUgnot={500000n}
                faucetUrl="https://faucet.gno.land"
                onSuccess={onSuccess}
            />
        )

        fireEvent.click(screen.getByRole("button", { name: /Activate My Wallet/i }))

        expect(await screen.findByText(/Transaction blocked/i)).toBeInTheDocument()
        expect(onSuccess).not.toHaveBeenCalled()
    })
})
