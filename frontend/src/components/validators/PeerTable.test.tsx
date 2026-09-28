import { describe, expect, it } from "vitest"
import { fireEvent, render, screen, within } from "@testing-library/react"
import { PeerTable } from "./PeerTable"
import type { NetInfo, PeerInfo } from "../../lib/validators"

function peer(moniker: string, rpcAddr: string): PeerInfo {
    return {
        nodeId: moniker,
        ip: "192.0.2.1",
        p2pAddr: "",
        moniker,
        network: "gnoland-1",
        isOutbound: true,
        remoteHeight: 100,
        rpcAddr,
        seenByCount: 1,
    }
}

describe("PeerTable RPC address labels", () => {
    it("filters by advertised RPC address without claiming validator status or RPC health", () => {
        const netInfo: NetInfo = {
            listening: true,
            peerCount: 2,
            peers: [peer("rpc-peer", "tcp://192.0.2.1:26657"), peer("private-peer", "")],
        }
        render(<PeerTable netInfo={netInfo} loading={false} />)

        const table = screen.getByRole("table", { name: "Connected peers" })
        expect(within(table).getByText("private-peer")).toBeInTheDocument()
        expect(screen.getByRole("link", { name: /RPC address/ })).toHaveAttribute("href", "http://192.0.2.1:26657/")
        expect(screen.queryByText(/OK rpc|rpc-closed|only validators/i)).not.toBeInTheDocument()

        fireEvent.click(screen.getByRole("checkbox", { name: "peers advertising RPC" }))
        expect(within(table).getByText("rpc-peer")).toBeInTheDocument()
        expect(within(table).queryByText("private-peer")).not.toBeInTheDocument()
    })

    it("does not make loopback or private peer RPC addresses clickable", () => {
        const netInfo: NetInfo = {
            listening: true,
            peerCount: 5,
            peers: [
                { ...peer("localhost", "tcp://127.0.0.1:26657"), ip: "127.0.0.1" },
                { ...peer("private", "tcp://192.168.1.3:26657"), ip: "192.168.1.3" },
                { ...peer("local-name", "tcp://node.local:26657"), ip: "node.local" },
                { ...peer("local-dot", "tcp://localhost.:26657"), ip: "localhost." },
                peer("public", "tcp://192.0.2.1:26657"),
            ],
        }
        render(<PeerTable netInfo={netInfo} loading={false} />)
        expect(screen.getAllByText("No dialable address")).toHaveLength(4)
        expect(screen.getAllByText("Private address")).toHaveLength(4)
        expect(screen.getAllByRole("link", { name: /RPC address/ })).toHaveLength(1)
    })
})
