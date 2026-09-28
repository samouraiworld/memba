import { afterEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { ConnectSection } from "./ConnectSection"
import type { NodeStatus } from "../../lib/validators"

const nodeStatus: NodeStatus = {
    moniker: "test node",
    version: "1.0",
    nodeId: "abc123",
    listenAddr: "tcp://192.0.2.1:26656",
    rpcAddr: "",
    validatorAddr: "",
    pubkey: "",
    catchingUp: false,
    genesisHash: "hash123",
    chainId: "test13",
}

afterEach(() => vi.restoreAllMocks())

describe("ConnectSection copy controls", () => {
    it("uses native buttons so Enter and Space have standard activation", async () => {
        const writeText = vi.fn().mockResolvedValue(undefined)
        Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true })
        render(<ConnectSection nodeStatus={nodeStatus} />)

        const seed = screen.getByRole("button", { name: /Copy P2P address: abc123@192\.0\.2\.1:26656/ })
        expect(seed.tagName).toBe("BUTTON")
        fireEvent.click(seed)
        await waitFor(() => expect(writeText).toHaveBeenCalledWith("abc123@192.0.2.1:26656"))
        await waitFor(() => expect(seed).toHaveAccessibleName(/Copied P2P address:/))
    })

    it("does not offer wildcard addresses or placeholders as copyable connection details", () => {
        render(<ConnectSection nodeStatus={{ ...nodeStatus, listenAddr: "tcp://0.0.0.0:26656", genesisHash: "unknown" }} />)
        expect(screen.getByText("Public dialable address not advertised")).toBeInTheDocument()
        expect(screen.getByText("Unavailable")).toBeInTheDocument()
        expect(screen.queryByRole("button", { name: /Copy P2P address|Copy latest app hash/ })).not.toBeInTheDocument()
    })

    it("shows a failure rather than claiming a rejected clipboard write succeeded", async () => {
        Object.defineProperty(navigator, "clipboard", {
            value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
            configurable: true,
        })
        render(<ConnectSection nodeStatus={nodeStatus} />)

        const hash = screen.getByRole("button", { name: /Copy latest app hash:/ })
        fireEvent.click(hash)
        await waitFor(() => expect(hash).toHaveAccessibleName(/Could not copy latest app hash:/))
        expect(hash).toHaveTextContent("Copy failed")
        expect(hash).not.toHaveTextContent("✓ copied")
    })
})
