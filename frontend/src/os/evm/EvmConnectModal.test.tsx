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
        signIn: vi.fn(async () => {}),
        evm: { wallets: [{ uid: "w1", name: "Rabby", icon: "data:image/svg+xml,x" }], choose: vi.fn(), wrongChain: false, displayAddress: "0xabCDeF0123456789AbcdEf0123456789aBCDEF01", ...evm },
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

    it("on the right chain, asks to sign in, showing the address in its EIP-55 form", () => {
        const s = session({ stage: "login", walletAddress: "0xabcdef0123456789abcdef0123456789abcdef01", walletChainId: "84532" })
        render(<EvmConnectModal session={s} />)
        expect(screen.getByRole("heading", { name: "Connected · 0xabCDeF…EF01" })).toBeInTheDocument()
        fireEvent.click(screen.getByRole("button", { name: "Sign in" }))
        expect(s.signIn).toHaveBeenCalled()
        fireEvent.click(screen.getByRole("button", { name: "Disconnect" }))
        expect(s.disconnect).toHaveBeenCalled()
    })

    it("waits while the wallet shows the sign-in message", () => {
        render(<EvmConnectModal session={session({ stage: "loginwait" })} />)
        expect(screen.getByText("Waiting for your wallet…")).toBeInTheDocument()
        expect(screen.getByText(/costs nothing and sends no transaction/)).toBeInTheDocument()
    })

    it("shows nothing without a step", () => {
        const { container } = render(<EvmConnectModal session={session({ stage: null })} />)
        expect(container).toBeEmptyDOMElement()
    })
})
