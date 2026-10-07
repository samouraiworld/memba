import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import type { OsSession } from "../shell/useOsSession"
import { EvmConnectModal } from "./EvmConnectModal"

function session(over: Partial<OsSession> & { evm?: Partial<NonNullable<OsSession["evm"]>> } = {}) {
    const { evm, ...rest } = over
    return {
        stage: "pick", error: null, walletAddress: "", walletChainId: "",
        network: { key: "base-sepolia", family: "evm", chainId: "84532", label: "Base Sepolia", isTestnet: true, rpcHost: "" },
        cancel: vi.fn(), disconnect: vi.fn(), switchWallet: vi.fn(async () => true),
        ...rest,
        evm: { wallets: [{ uid: "w1", name: "Rabby", icon: "data:image/svg+xml,x" }], choose: vi.fn(), wrongChain: false, ...evm },
    } as unknown as OsSession
}

describe("EvmConnectModal", () => {
    it("lists the wallets this browser announced and connects the one picked", () => {
        const s = session()
        render(<EvmConnectModal session={s} />)
        fireEvent.click(screen.getByRole("button", { name: "Rabby" }))
        expect(s.evm!.choose).toHaveBeenCalledWith("w1")
    })

    it("says how to get a wallet when none is found", () => {
        render(<EvmConnectModal session={session({ evm: { wallets: [] } })} />)
        expect(screen.getByText(/No wallet found in this browser/)).toBeInTheDocument()
    })

    it("asks to switch a wallet that is on another chain, and says so when it won't", async () => {
        const s = session({ stage: "login", walletAddress: "0xabcdef0123456789abcdef0123456789abcdef01", walletChainId: "8453", switchWallet: vi.fn(async () => false), evm: { wrongChain: true } })
        render(<EvmConnectModal session={s} />)
        expect(screen.getByText("Your wallet is on chain 8453. Switch it to Base Sepolia to sign in.")).toBeInTheDocument()
        fireEvent.click(screen.getByRole("button", { name: "Switch wallet to Base Sepolia" }))
        expect(await screen.findByRole("alert")).toHaveTextContent("The wallet didn't switch.")
    })

    it("on the right chain, tells a connected wallet that signing in comes soon", () => {
        const s = session({ stage: "login", walletAddress: "0xabcdef0123456789abcdef0123456789abcdef01", walletChainId: "84532" })
        render(<EvmConnectModal session={s} />)
        expect(screen.getByText(/Signing in to Memba with this wallet comes in an update soon/)).toBeInTheDocument()
        fireEvent.click(screen.getByRole("button", { name: "Disconnect" }))
        expect(s.disconnect).toHaveBeenCalled()
    })

    it("shows nothing without a step", () => {
        const { container } = render(<EvmConnectModal session={session({ stage: null })} />)
        expect(container).toBeEmptyDOMElement()
    })
})
