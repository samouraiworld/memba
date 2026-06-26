import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock the RPC layer so we can assert call counts (single-flight + cache).
vi.mock("./rpcFallback", () => ({
    resilientRpcCall: vi.fn(),
}))

import { resilientRpcCall } from "./rpcFallback"
import {
    blockResultToEpochMs,
    fetchBlockTime,
    fetchBlockTimes,
    __resetBlockTimeRpcCache,
} from "./blockTimeRpc"

const mockRpc = vi.mocked(resilientRpcCall)

function blockAt(time: string) {
    return { block: { header: { time } } }
}

describe("blockResultToEpochMs", () => {
    it("parses an RFC3339 block time to epoch ms", () => {
        const ms = blockResultToEpochMs(blockAt("2026-06-24T11:17:29.039Z"))
        expect(ms).toBe(Date.parse("2026-06-24T11:17:29.039Z"))
    })

    it("returns null for missing / malformed shapes", () => {
        expect(blockResultToEpochMs(null)).toBeNull()
        expect(blockResultToEpochMs({})).toBeNull()
        expect(blockResultToEpochMs({ block: { header: {} } })).toBeNull()
        expect(blockResultToEpochMs(blockAt("not-a-date"))).toBeNull()
    })
})

describe("fetchBlockTime", () => {
    beforeEach(() => {
        __resetBlockTimeRpcCache()
        mockRpc.mockReset()
    })

    it("returns null for invalid heights without calling RPC", async () => {
        expect(await fetchBlockTime(0)).toBeNull()
        expect(await fetchBlockTime(-5)).toBeNull()
        expect(mockRpc).not.toHaveBeenCalled()
    })

    it("resolves a height to its block time", async () => {
        mockRpc.mockResolvedValueOnce(blockAt("2026-06-24T11:17:29Z"))
        const ms = await fetchBlockTime(432000)
        expect(ms).toBe(Date.parse("2026-06-24T11:17:29Z"))
        expect(mockRpc).toHaveBeenCalledWith("/block", { height: "432000" })
    })

    it("caches a resolved height (second call makes no RPC)", async () => {
        mockRpc.mockResolvedValueOnce(blockAt("2026-06-24T11:17:29Z"))
        await fetchBlockTime(432000)
        await fetchBlockTime(432000)
        expect(mockRpc).toHaveBeenCalledTimes(1)
    })

    it("dedupes concurrent in-flight requests for the same height", async () => {
        let resolve!: (v: unknown) => void
        mockRpc.mockReturnValueOnce(new Promise((r) => { resolve = r }))
        const a = fetchBlockTime(500)
        const b = fetchBlockTime(500)
        resolve(blockAt("2026-06-25T00:00:00Z"))
        const [ra, rb] = await Promise.all([a, b])
        expect(ra).toBe(rb)
        expect(mockRpc).toHaveBeenCalledTimes(1)
    })

    it("returns null and does NOT cache on transient failure (retry can succeed)", async () => {
        mockRpc.mockRejectedValueOnce(new Error("network down"))
        expect(await fetchBlockTime(700)).toBeNull()
        mockRpc.mockResolvedValueOnce(blockAt("2026-06-26T00:00:00Z"))
        expect(await fetchBlockTime(700)).toBe(Date.parse("2026-06-26T00:00:00Z"))
        expect(mockRpc).toHaveBeenCalledTimes(2)
    })
})

describe("fetchBlockTimes", () => {
    beforeEach(() => {
        __resetBlockTimeRpcCache()
        mockRpc.mockReset()
    })

    it("resolves distinct heights once each and skips invalid ones", async () => {
        mockRpc.mockImplementation(async (_m, params) => {
            const h = Number((params as Record<string, string>).height)
            return blockAt(new Date(h * 1000).toISOString())
        })
        const map = await fetchBlockTimes([100, 100, 200, 0, -1])
        expect(map.get(100)).toBe(100 * 1000)
        expect(map.get(200)).toBe(200 * 1000)
        expect(map.has(0)).toBe(false)
        expect(mockRpc).toHaveBeenCalledTimes(2) // 100 and 200, deduped
    })
})
