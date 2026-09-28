import { describe, expect, it } from "vitest"
import { render, screen, within } from "@testing-library/react"
import { NodeStatePanel } from "./NodeStatePanel"
import { publicRpcLink } from "./nodeStateLinks"
import type { NodeStatus } from "../../lib/validators"

const node: NodeStatus = {
    moniker: "node", version: "v1", nodeId: "abc", listenAddr: "tcp://0.0.0.0:26656",
    rpcAddr: "tcp://127.0.0.1:26657", validatorAddr: "", pubkey: "",
    catchingUp: false, genesisHash: "", chainId: "gnoland-1", nodeTime: "",
    peerCount: 0,
}

describe("NodeStatePanel RPC links", () => {
    it.each([
        "tcp://0.0.0.0:26657", "tcp://127.0.0.1:26657", "192.168.1.2:26657",
        "10.0.0.1:26657", "172.16.0.1:26657", "[::1]:26657",
        "[fe80::1]:26657", "localhost:26657", "node.local:26657",
        "javascript:alert(1)",
    ])("does not create a public link for %s", address => {
        expect(publicRpcLink(address)).toBeUndefined()
    })

    it("links only a public RPC address with an HTTP scheme", () => {
        expect(publicRpcLink("tcp://rpc.example.org:26657")).toBe("http://rpc.example.org:26657/")
        expect(publicRpcLink("https://rpc.example.org/")).toBe("https://rpc.example.org/")
    })

    it("renders private address as diagnostic text without a link", () => {
        render(<NodeStatePanel nodeStatus={node} loading={false} />)
        expect(screen.getByText("tcp://127.0.0.1:26657")).toBeInTheDocument()
        expect(screen.queryByRole("link", { name: /127\.0\.0\.1/ })).not.toBeInTheDocument()
    })

    it("renders an invalid node timestamp as unknown", () => {
        render(<NodeStatePanel nodeStatus={{ ...node, nodeTime: "not-a-date" }} loading={false} />)
        const row = screen.getByText("node time (UTC)").closest(".nsg-row")
        expect(row).not.toBeNull()
        expect(within(row as HTMLElement).getByText("unknown")).toBeInTheDocument()
    })
})
