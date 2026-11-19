import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { formatBlockAge, checkNetworkHealth } from "./networkStatus"

// Deterministic RPC URL list: one node unless a test sets several.
const rpc = vi.hoisted(() => ({ urls: ["https://rpc.test"], prefer: vi.fn() }))
vi.mock("./rpcFallback", () => ({
    getRpcUrlsInOrder: () => [...rpc.urls],
    preferRpcEndpoint: rpc.prefer,
}))
vi.mock("./config", () => ({ GNO_CHAIN_ID: "test13" }))

describe("formatBlockAge", () => {
    it.each([Infinity, NaN, -1])("does not invent an age for unavailable block data (%s)", seconds => expect(formatBlockAge(seconds)).toBe("Unavailable"))
    it("formats seconds", () => expect(formatBlockAge(30)).toBe("30s ago"))
    it("formats minutes", () => expect(formatBlockAge(120)).toBe("2m ago"))
    it("formats hours", () => expect(formatBlockAge(7200)).toBe("2h ago"))
    it("formats days", () => expect(formatBlockAge(172800)).toBe("2d ago"))
    it("formats 0", () => expect(formatBlockAge(0)).toBe("0s ago"))
})

/**
 * Build a mock /status Response with a controllable HTTP `Date` header
 * (the RPC node's own wall clock) and latest_block_time.
 */
function mockStatus({
    blockTime,
    serverDate,
    chainId = "test13",
    height,
}: {
    blockTime: string
    serverDate?: string | null
    chainId?: string
    height?: number
}): Response {
    return {
        ok: true,
        json: async () => ({
            result: {
                node_info: { network: chainId },
                sync_info: { latest_block_time: blockTime, ...(height === undefined ? {} : { latest_block_height: String(height) }) },
            },
        }),
        headers: {
            get: (name: string) =>
                name.toLowerCase() === "date" ? (serverDate ?? null) : null,
        },
    } as unknown as Response
}

describe("checkNetworkHealth — clock-skew resilience", () => {
    beforeEach(() => {
        vi.useFakeTimers()
    })
    afterEach(() => {
        vi.useRealTimers()
        vi.restoreAllMocks()
    })

    it("reports healthy for a fresh block even when the CLIENT clock is 10 minutes fast", async () => {
        // Server agrees only 3s passed since the last block → chain is fine.
        const block = "2026-06-26T17:00:00.000Z"
        const serverNow = "2026-06-26T17:00:03.000Z"
        // Client clock is 10 minutes ahead of reality.
        vi.setSystemTime(new Date("2026-06-26T17:10:00.000Z"))
        vi.stubGlobal("fetch", vi.fn(async () => mockStatus({ blockTime: block, serverDate: serverNow })))

        const result = await checkNetworkHealth("https://rpc.test")

        expect(result.health).toBe("healthy")
        expect(result.blockAge).toBe(3)
    })

    it("reports halted when the SERVER clock confirms 5+ min with no new block (client clock normal)", async () => {
        const block = "2026-06-26T17:00:00.000Z"
        const serverNow = "2026-06-26T17:10:00.000Z" // node itself says 10 min elapsed
        vi.setSystemTime(new Date("2026-06-26T17:00:01.000Z")) // client clock is fine
        vi.stubGlobal("fetch", vi.fn(async () => mockStatus({ blockTime: block, serverDate: serverNow })))

        const result = await checkNetworkHealth("https://rpc.test")

        expect(result.health).toBe("halted")
        expect(result.blockAge).toBe(600)
    })

    it("falls back to the client clock when the response has no Date header", async () => {
        const block = "2026-06-26T17:00:00.000Z"
        vi.setSystemTime(new Date("2026-06-26T17:00:04.000Z"))
        vi.stubGlobal("fetch", vi.fn(async () => mockStatus({ blockTime: block, serverDate: null })))

        const result = await checkNetworkHealth("https://rpc.test")

        expect(result.health).toBe("healthy")
        expect(result.blockAge).toBe(4)
    })

    it("falls back to the client clock when the Date header is present but unparseable", async () => {
        const block = "2026-06-26T17:00:00.000Z"
        vi.setSystemTime(new Date("2026-06-26T17:00:07.000Z"))
        vi.stubGlobal("fetch", vi.fn(async () => mockStatus({ blockTime: block, serverDate: "not-a-date" })))

        const result = await checkNetworkHealth("https://rpc.test")

        expect(result.health).toBe("healthy")
        expect(result.blockAge).toBe(7)
    })

    it("clamps a slightly-ahead block (server Date just behind block time) to age 0, not a negative", async () => {
        const block = "2026-06-26T17:00:02.000Z"
        const serverNow = "2026-06-26T17:00:00.000Z" // header rounded 2s behind block
        vi.setSystemTime(new Date("2026-06-26T17:00:00.000Z"))
        vi.stubGlobal("fetch", vi.fn(async () => mockStatus({ blockTime: block, serverDate: serverNow })))

        const result = await checkNetworkHealth("https://rpc.test")

        expect(result.health).toBe("healthy")
        expect(result.blockAge).toBe(0)
    })
})

// A node can keep answering while frozen at an old height (gnoland-1, 2026-11-18:
// rpc.gno.land stayed at the v1.8.0 halt height after the chain restarted). Error
// failover never leaves it, so the health check reads every node, judges the
// chain by the most advanced one, and makes that one the first tried.
describe("checkNetworkHealth — a node left behind", () => {
    const PRIMARY = "https://primary.test"
    const FALLBACK = "https://fallback.test"
    const NOW = "2026-11-18T13:40:00.000Z"
    const HALT = { blockTime: "2026-11-18T13:16:54.000Z", height: 1651500 } // 23 min old
    const LIVE = { blockTime: "2026-11-18T13:39:57.000Z", height: 1651900 } // 3 s old

    beforeEach(() => {
        rpc.urls = [PRIMARY, FALLBACK]
        rpc.prefer.mockClear()
    })
    afterEach(() => {
        rpc.urls = ["https://rpc.test"]
        vi.unstubAllGlobals()
    })

    function nodes(answers: Record<string, Parameters<typeof mockStatus>[0] | "down">) {
        vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
            const answer = answers[new URL(String(input)).origin]
            if (!answer || answer === "down") throw new TypeError("Failed to fetch")
            return mockStatus({ serverDate: NOW, ...answer })
        }))
    }

    it("reads the chain from the node that follows it, and tries that node first from now on", async () => {
        nodes({ [PRIMARY]: HALT, [FALLBACK]: LIVE })
        const result = await checkNetworkHealth(PRIMARY)
        expect(result.health).toBe("healthy")
        expect(result.blockAge).toBe(3)
        expect(rpc.prefer).toHaveBeenCalledWith(FALLBACK)
    })

    it("reports a halt when every node is stuck, and moves no node", async () => {
        nodes({ [PRIMARY]: HALT, [FALLBACK]: { ...HALT, blockTime: "2026-11-18T13:16:54.000Z" } })
        const result = await checkNetworkHealth(PRIMARY)
        expect(result.health).toBe("halted")
        expect(result.blockAge).toBe(1386)
        expect(rpc.prefer).not.toHaveBeenCalled()
    })

    it("never takes a node on another chain for this one", async () => {
        nodes({ [PRIMARY]: HALT, [FALLBACK]: { ...LIVE, chainId: "other-1" } })
        const result = await checkNetworkHealth(PRIMARY)
        expect(result.health).toBe("halted")
        expect(result.chainId).toBe("test13")
        expect(rpc.prefer).not.toHaveBeenCalled()
    })

    it("leaves a node that is a block behind but still young", async () => {
        nodes({ [PRIMARY]: { blockTime: "2026-11-18T13:39:54.000Z", height: 1651899 }, [FALLBACK]: LIVE })
        const result = await checkNetworkHealth(PRIMARY)
        expect(result.blockAge).toBe(3)
        expect(rpc.prefer).not.toHaveBeenCalled()
    })

    it("moves a node a minute stale before the chain itself would read as halted", async () => {
        nodes({ [PRIMARY]: { blockTime: "2026-11-18T13:38:59.000Z", height: 1651880 }, [FALLBACK]: LIVE })
        await checkNetworkHealth(PRIMARY)
        expect(rpc.prefer).toHaveBeenCalledWith(FALLBACK)
    })

    it("moves no node to one that is no further ahead", async () => {
        nodes({ [PRIMARY]: HALT, [FALLBACK]: { blockTime: "2026-11-18T13:39:57.000Z", height: 1651500 } })
        await checkNetworkHealth(PRIMARY)
        expect(rpc.prefer).not.toHaveBeenCalled()
    })

    it("leaves a primary that is down to the error failover, and reads the chain from the other node", async () => {
        nodes({ [PRIMARY]: "down", [FALLBACK]: LIVE })
        const result = await checkNetworkHealth(PRIMARY)
        expect(result.health).toBe("healthy")
        expect(rpc.prefer).not.toHaveBeenCalled()
    })

    it("never moves to, nor reads the chain from, a node whose block is from its own future", async () => {
        nodes({ [PRIMARY]: HALT, [FALLBACK]: { blockTime: "2026-11-18T13:45:00.000Z", height: 9_999_999 } })
        const result = await checkNetworkHealth(PRIMARY)
        expect(result.health).toBe("halted")
        expect(rpc.prefer).not.toHaveBeenCalled()
    })

    it("ignores a node whose block time cannot be read, so it cannot hide a halt", async () => {
        nodes({ [PRIMARY]: HALT, [FALLBACK]: { blockTime: "invalid-time", height: 1651900 } })
        const result = await checkNetworkHealth(PRIMARY)
        expect(result.health).toBe("halted")
        expect(result.blockAge).toBe(1386)
        expect(rpc.prefer).not.toHaveBeenCalled()
    })

    it("is unreachable only when no node answers", async () => {
        nodes({ [PRIMARY]: "down", [FALLBACK]: "down" })
        const result = await checkNetworkHealth(PRIMARY)
        expect(result.health).toBe("unreachable")
    })
})
