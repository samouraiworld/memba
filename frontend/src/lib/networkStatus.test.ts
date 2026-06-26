import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { formatBlockAge, checkNetworkHealth } from "./networkStatus"

// Deterministic RPC URL list so checkNetworkHealth's loop hits our mocked fetch once.
vi.mock("./rpcFallback", () => ({
    getRpcUrlsInOrder: () => ["https://rpc.test"],
}))

describe("formatBlockAge", () => {
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
}: {
    blockTime: string
    serverDate?: string | null
    chainId?: string
}): Response {
    return {
        ok: true,
        json: async () => ({
            result: {
                node_info: { network: chainId },
                sync_info: { latest_block_time: blockTime },
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
