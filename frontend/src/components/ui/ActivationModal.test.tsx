import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
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

    it("triggers Adena DoContract on activate", async () => {
        const adenaMock = {
            DoContract: vi.fn().mockResolvedValue({ status: "success" }),
        }
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

        const btn = screen.getByRole("button", { name: /Activate My Wallet/i })
        fireEvent.click(btn)

        // Wait for async handler
        await screen.findByText(/Activating.../i)
        
        // Assert adena was called
        expect(adenaMock.DoContract).toHaveBeenCalledWith({
            messages: [
                {
                    type: "bank/MsgSend",
                    value: {
                        from_address: "g1abc",
                        to_address: "g1abc",
                        amount: [{ denom: "ugnot", amount: "1" }],
                    },
                },
            ],
            gasFee: 1000000,
            gasWanted: 10000000,
            memo: "Memba Network Activation",
        })
        
        // Since we mocked success, it should call onSuccess
        // Wait for onSuccess to be called
        await vi.waitFor(() => {
            expect(onSuccess).toHaveBeenCalled()
        })
    })
})
