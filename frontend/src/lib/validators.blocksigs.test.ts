/**
 * fetchLastBlockSignatures — windowing and the incremental block cache.
 *
 * WHY THIS EXISTS. The roster asked for 100 blocks and re-fetched all 100 on
 * every 30s poll, so one open tab issued ~200 /block requests per minute
 * (measured on prod: 101 on /validators, 157 on /validators/hacker). Load scaled
 * linearly with concurrent readers against a single node — on mainnet
 * `fallbackRpcUrls` is empty, so there is no second host to absorb it.
 *
 * Blocks are immutable once committed, which makes the re-fetch pure waste: the
 * only blocks that can be new on the next tick are the ones since the last tip.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

const { resilientRpcCall } = vi.hoisted(() => ({ resilientRpcCall: vi.fn() }))
vi.mock("./rpcFallback", () => ({ resilientRpcCall }))

const { fetchLastBlockSignatures, __resetBlockSigCacheForTests } = await import("./validators")

const VAL_A = "g1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
const VAL_B = "g1bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"

/** gno nil-pads precommits to valset size — a miss is a null slot, not an omission. */
function block(height: number, signers: string[], valset = [VAL_A, VAL_B]) {
    return {
        block: {
            last_commit: {
                precommits: valset.map((addr) =>
                    signers.includes(addr) ? { validator_address: addr, height: String(height) } : null,
                ),
            },
        },
    }
}

function mockChain(tip: number, signersAt: (h: number) => string[]) {
    resilientRpcCall.mockImplementation((method: string, params?: Record<string, string>) => {
        if (method === "/status") {
            return Promise.resolve({ sync_info: { latest_block_height: String(tip) } })
        }
        if (method === "/block") {
            const h = Number(params?.height)
            return Promise.resolve(block(h, signersAt(h)))
        }
        return Promise.resolve(null)
    })
}

/** Heights actually requested from the chain, in call order. */
function requestedHeights(): number[] {
    return resilientRpcCall.mock.calls
        .filter(([method]) => method === "/block")
        .map(([, params]) => Number(params.height))
}

describe("fetchLastBlockSignatures", () => {
    beforeEach(() => {
        resilientRpcCall.mockReset()
        __resetBlockSigCacheForTests()
    })

    it("fetches the requested window on a cold cache", async () => {
        mockChain(100, () => [VAL_A, VAL_B])
        const map = await fetchLastBlockSignatures("rpc", 20)

        expect(requestedHeights()).toHaveLength(20)
        expect(map.get(VAL_A)).toHaveLength(20)
        expect(map.get(VAL_A)!.every(Boolean)).toBe(true)
    })

    it("orders results most-recent-first", async () => {
        // A signs everything except the current tip.
        mockChain(100, (h) => (h === 100 ? [VAL_B] : [VAL_A, VAL_B]))
        const map = await fetchLastBlockSignatures("rpc", 5)

        expect(map.get(VAL_A)![0]).toBe(false)
        expect(map.get(VAL_A)!.slice(1).every(Boolean)).toBe(true)
    })

    it("re-fetches ONLY the new blocks when the tip advances", async () => {
        mockChain(100, () => [VAL_A, VAL_B])
        await fetchLastBlockSignatures("rpc", 20)
        const first = requestedHeights().length
        expect(first).toBe(20)

        resilientRpcCall.mockClear()
        mockChain(103, () => [VAL_A, VAL_B])
        const map = await fetchLastBlockSignatures("rpc", 20)

        // Three new heights; the other 17 come from cache.
        expect(requestedHeights().sort((a, b) => a - b)).toEqual([101, 102, 103])
        // …and the window is still complete and correctly ordered.
        expect(map.get(VAL_A)).toHaveLength(20)
    })

    it("issues no block requests at all when the tip has not moved", async () => {
        mockChain(100, () => [VAL_A, VAL_B])
        await fetchLastBlockSignatures("rpc", 20)

        resilientRpcCall.mockClear()
        mockChain(100, () => [VAL_A, VAL_B])
        const map = await fetchLastBlockSignatures("rpc", 20)

        expect(requestedHeights()).toEqual([])
        expect(map.get(VAL_A)).toHaveLength(20)
    })

    it("records a miss as false — a nil precommit slot is a missed block", async () => {
        mockChain(100, (h) => (h % 2 === 0 ? [VAL_A, VAL_B] : [VAL_B]))
        const map = await fetchLastBlockSignatures("rpc", 10)

        const a = map.get(VAL_A)!
        expect(a).toHaveLength(10)
        expect(a.filter(Boolean)).toHaveLength(5)
        // B never missed.
        expect(map.get(VAL_B)!.every(Boolean)).toBe(true)
    })

    it("omits a validator that signed nothing in the window — the caller seeds it", async () => {
        // gno nil-pads, so a validator down for the WHOLE window never supplies a
        // validator_address anywhere and cannot be discovered from precommits.
        // Callers must fill it from the roster; see Validators.tsx.
        mockChain(100, () => [VAL_B])
        const map = await fetchLastBlockSignatures("rpc", 10)

        expect(map.has(VAL_A)).toBe(false)
        expect(map.get(VAL_B)!.every(Boolean)).toBe(true)
    })

    it("does not grow the cache without bound as the chain advances", async () => {
        mockChain(100, () => [VAL_A])
        await fetchLastBlockSignatures("rpc", 20)
        mockChain(5000, () => [VAL_A])
        await fetchLastBlockSignatures("rpc", 20)

        // A long jump must not retain the old, now-irrelevant heights.
        const map = await fetchLastBlockSignatures("rpc", 20)
        expect(map.get(VAL_A)).toHaveLength(20)
    })

    it("degrades to an empty map when /status fails, without throwing", async () => {
        resilientRpcCall.mockRejectedValue(new Error("RPC down"))
        await expect(fetchLastBlockSignatures("rpc", 20)).resolves.toEqual(new Map())
    })
})
