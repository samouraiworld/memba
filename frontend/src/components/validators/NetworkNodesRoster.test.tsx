import { afterEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { NetworkNodesRoster } from "./NetworkNodesRoster"
import type { NetInfo } from "../../lib/validators"

const nodeId = "0123456789abcdef0123456789abcdef01234567"
const netInfo: NetInfo = {
    listening: true,
    peerCount: 1,
    peers: [{
        nodeId,
        ip: "192.0.2.1",
        p2pAddr: "",
        moniker: "Test peer",
        network: "test13",
        isOutbound: true,
        remoteHeight: 100,
        rpcAddr: "",
        seenByCount: 1,
    }],
}

afterEach(() => vi.restoreAllMocks())

describe("NetworkNodesRoster accessibility", () => {
    it("keeps a persistent search label and exposes the full node ID through a native disclosure", () => {
        render(<NetworkNodesRoster netInfo={netInfo} validatorMonikers={new Set()} loading={false} />)

        const search = screen.getByRole("textbox", { name: "Search network nodes" })
        fireEvent.change(search, { target: { value: "Test" } })
        expect(search).toHaveValue("Test")
        expect(screen.getByText("Search network nodes")).toBeVisible()

        const summary = screen.getByText("0123456789ab…")
        expect(summary.tagName).toBe("SUMMARY")
        expect(summary).toHaveAccessibleName(`Node ID ${nodeId}. Show full ID and copy`)
        fireEvent.click(summary)
        expect(screen.getByText(nodeId)).toBeVisible()
    })

    it("copies the full ID and reports clipboard failures honestly", async () => {
        const writeText = vi.fn().mockRejectedValueOnce(new Error("denied")).mockResolvedValueOnce(undefined)
        Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true })
        render(<NetworkNodesRoster netInfo={netInfo} validatorMonikers={new Set()} loading={false} />)
        fireEvent.click(screen.getByText("0123456789ab…"))

        const copy = screen.getByRole("button", { name: `Copy node ID ${nodeId}` })
        fireEvent.click(copy)
        await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Copy failed"))
        fireEvent.click(copy)
        await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Copied"))
        expect(writeText).toHaveBeenCalledTimes(2)
        expect(writeText).toHaveBeenCalledWith(nodeId)
    })

    it("labels name-based roles as inferred rather than a consensus count", () => {
        render(<NetworkNodesRoster netInfo={{ ...netInfo, peers: [{ ...netInfo.peers[0], moniker: "validator candidate" }] }} validatorMonikers={new Set()} loading={false} />)
        expect(screen.getByText("Inferred role")).toBeInTheDocument()
        expect(screen.getByText("Possible validator")).toBeInTheDocument()
        expect(screen.queryByText(/1 validator/)).not.toBeInTheDocument()
    })
})
