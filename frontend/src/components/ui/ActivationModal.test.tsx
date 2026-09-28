import { ACTIVATION_PROFILE_REALM } from "../../lib/config"
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
    it("offers a balance retry after the RPC fails in the forced flow", () => {
        const retry = vi.fn()
        render(<ActivationModal address="g1..." balanceError="RPC unavailable" onRetryBalance={retry} faucetUrl="https://faucet.gno.land" onSuccess={() => {}} />)
        expect(screen.getByText(/Could not check your GNOT balance/)).toBeInTheDocument()
        fireEvent.click(screen.getByRole("button", { name: "Retry balance check" }))
        expect(retry).toHaveBeenCalledOnce()
    })

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

    it("does not activate from a retained balance while refreshing or after a failed check", () => {
        doContractBroadcast.mockClear()
        const retry = vi.fn()
        const props = { address: "g1...", rawUgnot: 500000n, onRetryBalance: retry, faucetUrl: "https://faucet.gno.land", onSuccess: vi.fn() }
        const { rerender } = render(<ActivationModal {...props} />)
        expect(screen.getByRole("button", { name: /Activate My Wallet/i })).toBeEnabled()

        rerender(<ActivationModal {...props} balanceLoading />)
        expect(screen.queryByRole("button", { name: /Activate My Wallet/i })).not.toBeInTheDocument()
        expect(screen.getByText(/Checking your GNOT balance/)).toBeInTheDocument()
        expect(screen.getByRole("button", { name: "Retry balance check" })).toBeDisabled()

        rerender(<ActivationModal {...props} balanceError="RPC unavailable" />)
        expect(screen.queryByRole("button", { name: /Activate My Wallet/i })).not.toBeInTheDocument()
        fireEvent.click(screen.getByRole("button", { name: "Retry balance check" }))
        expect(retry).toHaveBeenCalledOnce()
        expect(doContractBroadcast).not.toHaveBeenCalled()

        rerender(<ActivationModal {...props} rawUgnot={0n} />)
        expect(screen.getByText(/You need a tiny amount of GNOT to activate/i)).toBeInTheDocument()
        expect(screen.queryByRole("button", { name: /Activate My Wallet/i })).not.toBeInTheDocument()
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
        // #1078: activation must be a VM call — Adena's DoContract rejects the
        // bank/MsgSend TYPE wholesale, so a send-shaped activation is a
        // guaranteed dead end for exactly the fresh wallets this modal serves.
        expect(doContractBroadcast).toHaveBeenCalledWith(
            [
                {
                    type: "vm/MsgCall",
                    value: {
                        caller: "g1abc",
                        send: "",
                        pkg_path: ACTIVATION_PROFILE_REALM,
                        func: "SetStringField",
                        // "Bio" is from the realm's OWN field schema — custom
                        // keys panic ("unknown string profile field"). Empty
                        // value: an untransacted account has no profile to
                        // clobber, and "" renders as nothing.
                        args: ["Bio", ""],
                    },
                },
            ],
            "Memba Network Activation",
        )
        // The unguarded path must stay dead.
        expect(adenaMock.DoContract).not.toHaveBeenCalled()
    })

    // The dismiss affordance belongs ONLY to the signed-out entry point (login
    // refused with AUTH-ACTIVATE-01). The authenticated forced flow passes no
    // onDismiss and must stay escape-proof.
    it("renders no dismiss button unless onDismiss is provided (forced flow)", () => {
        render(
            <ActivationModal
                address="g1..."
                rawUgnot={0n}
                faucetUrl="https://faucet.gno.land"
                onSuccess={() => {}}
            />
        )
        expect(screen.queryByRole("button", { name: /not now/i })).not.toBeInTheDocument()
    })

    it("dismisses back to browsing when onDismiss is provided (signed-out flow)", () => {
        const onDismiss = vi.fn()
        render(
            <ActivationModal
                address="g1..."
                rawUgnot={0n}
                faucetUrl="https://faucet.gno.land"
                onSuccess={() => {}}
                onDismiss={onDismiss}
            />
        )
        fireEvent.click(screen.getByRole("button", { name: /not now/i }))
        expect(onDismiss).toHaveBeenCalledTimes(1)
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
