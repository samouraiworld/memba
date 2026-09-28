import { beforeEach, describe, expect, it, vi } from "vitest"
import { GNO_CHAIN_ID } from "./config"

const { directRpcCall } = vi.hoisted(() => ({ directRpcCall: vi.fn() }))
vi.mock("./rpcFallback", () => ({
    directRpcCall,
    resilientRpcCall: vi.fn(),
    getRpcUrlsInOrder: vi.fn(),
    excludeRpcEndpoint: vi.fn(),
}))

import { fetchBlockHeatmap, getMempoolStatus, getNetworkStats, getNodeStatus, type ValidatorRpcSnapshot } from "./validators"

const snapshot: ValidatorRpcSnapshot = {
    url: "https://verified.example",
    chainId: GNO_CHAIN_ID,
    height: 100,
    blockHash: "hash-100",
    status: {
        node_info: { network: GNO_CHAIN_ID, moniker: "verified" },
        sync_info: { latest_block_height: "100", latest_block_time: "2026-09-28T00:00:00Z", catching_up: false },
    },
}

function block(height: number, chainId = GNO_CHAIN_ID) {
    return {
        block: {
            header: { height: String(height), chain_id: chainId, time: "2026-09-28T00:00:00Z" },
            last_commit: { precommits: [{ validator_address: "g1signer", type: 2 }] },
        },
    }
}

describe("pinned validator telemetry", () => {
    beforeEach(() => directRpcCall.mockReset())

    it("uses the verified status without switching to another node", async () => {
        const node = await getNodeStatus("https://untrusted.example", undefined, snapshot)
        expect(node?.chainId).toBe(GNO_CHAIN_ID)
        expect(node?.moniker).toBe("verified")
        expect(directRpcCall).not.toHaveBeenCalled()
    })

    it("reads mempool data only from the verified node", async () => {
        directRpcCall.mockResolvedValue({ n_txs: "4", total_bytes: "120" })
        const mempool = await getMempoolStatus("https://untrusted.example", undefined, snapshot)
        expect(mempool).toEqual({ count: 4, totalBytes: 120 })
        expect(directRpcCall).toHaveBeenCalledWith(snapshot.url, "/num_unconfirmed_txs", {}, undefined)
    })

    it("caps heatmap at the verified tip and drops foreign-chain blocks", async () => {
        directRpcCall.mockImplementation((_url: string, method: string, params: Record<string, string>) => {
            if (method !== "/block") return Promise.resolve(null)
            const height = Number(params?.height)
            return Promise.resolve(block(height, height === 99 ? "gnoland1" : GNO_CHAIN_ID))
        })
        const samples = await fetchBlockHeatmap("https://untrusted.example", 105, 3, undefined, 3, snapshot)
        expect(samples.map(sample => sample.height)).toEqual([98, 100])
        expect(directRpcCall.mock.calls.every(([, method]) => method === "/block")).toBe(true)
        expect(directRpcCall.mock.calls.map(([url, , params]) => [url, params.height])).toEqual([
            [snapshot.url, "100"], [snapshot.url, "99"], [snapshot.url, "98"],
        ])
    })

    it("rejects a cancelled heatmap instead of returning partial samples", async () => {
        const controller = new AbortController()
        controller.abort()
        await expect(fetchBlockHeatmap("https://untrusted.example", 100, 3, controller.signal, 3, snapshot))
            .rejects.toMatchObject({ name: "AbortError" })
        expect(directRpcCall).not.toHaveBeenCalled()
    })

    it("does not calculate block time from a foreign-chain block", async () => {
        directRpcCall.mockResolvedValue(block(90, "gnoland1"))
        const stats = await getNetworkStats("https://untrusted.example", [], undefined, snapshot)
        expect(stats.avgBlockTime).toBe(0)
        expect(directRpcCall).toHaveBeenCalledWith(snapshot.url, "/block", { height: "90" }, undefined)
    })
})
