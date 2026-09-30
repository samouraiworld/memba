import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../lib/config", () => ({ GNO_CHAIN_ID: "gnoland-1", GNO_RPC_URL: "https://rpc.test" }))

import { accountMark, accountMarkAfterBlocks } from "./accountMark"

const ADDRESS = "g1" + "a".repeat(38)
const BEFORE = { sequence: "7", coins: "5000000ugnot" }
const AFTER = { sequence: "8", coins: "4990000ugnot" }
/** gno.land's block interval, to the tenth of a second. */
const BLOCK_MS = 3400

/**
 * The network and one node of it. `head()` is the network's last committed
 * block; the node answering is `lag` blocks behind it and, as tm2 nodes do,
 * still reports catching_up:false. A block's time is the commit time of the
 * block before it, so at the head it is between one and two intervals old.
 * An account can be read only at a height the network has committed.
 */
function chain(opts: {
    head: () => number
    account: (height: number) => { sequence: string; coins: string } | null
    lag?: number
    /** How long ago the network's head was committed (0 to one interval). */
    sinceCommit?: number
    network?: string
    catchingUp?: boolean
    /** Added to the device clock: negative is a clock that runs behind. */
    blockTime?: (height: number) => string
}) {
    const calls: { method: string; params: Record<string, string> }[] = []
    const committedAt = new Map<number, number>()
    const seen = (height: number) => {
        // First time a height is the head: it was committed `sinceCommit` ago (the first one) or just now.
        if (!committedAt.has(height)) committedAt.set(height, Date.now() - (committedAt.size === 0 ? opts.sinceCommit ?? 0 : 0))
        return committedAt.get(height)!
    }
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
        const { method, params } = JSON.parse(String(init.body)) as { method: string; params: Record<string, string> }
        calls.push({ method, params })
        const reply = (result: unknown) => new Response(JSON.stringify({ jsonrpc: "2.0", id: "memba", result }))
        const head = opts.head()
        const headCommitted = seen(head)
        if (method === "status") {
            const height = head - (opts.lag ?? 0)
            // Header time of block N = commit of N-1: one interval per block behind the head's own commit.
            const time = opts.blockTime?.(height) ?? new Date(headCommitted - (head - height + 1) * BLOCK_MS).toISOString().replace("Z", "386739Z")
            return reply({ node_info: { network: opts.network ?? "gnoland-1" }, sync_info: { latest_block_height: String(height), latest_block_time: time, catching_up: opts.catchingUp ?? false } })
        }
        const height = params.height ? Number(params.height) : head
        if (height > head) return reply({ response: { ResponseBase: { Error: { "@type": "/std.InternalError" }, Data: null } } })
        const account = opts.account(height)
        const body = account ? { BaseAccount: { address: params.path.split("/").at(-1), ...account } } : null
        return reply({ response: { ResponseBase: { Error: null, Data: btoa(JSON.stringify(body)) } } })
    }))
    return calls
}

/** The network commits a block every interval, starting from `first`. */
function ticking(first: number) {
    let head = first
    const timer = setInterval(() => { head += 1 }, BLOCK_MS)
    return { head: () => head, stop: () => clearInterval(timer) }
}

const outcome = (run: Promise<string>) => {
    let value = "pending"
    void run.then((mark) => { value = mark }, (err: Error) => { value = `rejected: ${err.message}` })
    return () => value
}

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe("accountMark", () => {
    it("is the sequence and the coins of the account, at the latest block or at a given one", async () => {
        const calls = chain({ head: () => 100, account: (height) => (height < 90 ? { sequence: "6", coins: "9000000ugnot" } : BEFORE) })
        expect(await accountMark(ADDRESS)).toBe("7 5000000ugnot")
        expect(await accountMark(ADDRESS, 80)).toBe("6 9000000ugnot")
        expect(calls.map((c) => c.params)).toEqual([
            { path: `auth/accounts/${ADDRESS}`, data: "" },
            { path: `auth/accounts/${ADDRESS}`, data: "", height: "80" },
        ])
    })

    it("has no value for an account the node does not know, or for a height it does not have", async () => {
        chain({ head: () => 100, account: (height) => (height === 100 ? null : BEFORE) })
        // A node without the account answering both reads must not look like "unchanged".
        await expect(accountMark(ADDRESS)).rejects.toThrow("could not be read")
        await expect(accountMark(ADDRESS, 101)).rejects.toThrow("could not be read")
    })

    it("refuses anything that is not an address before asking the node", async () => {
        const calls = chain({ head: () => 100, account: () => null })
        await expect(accountMark('g1x" OR "1')).rejects.toThrow("Not a gno.land address")
        expect(calls).toEqual([])
    })
})

describe("accountMarkAfterBlocks", () => {
    beforeEach(() => { vi.useFakeTimers() })

    it("reads the account three blocks after the head it was given, however long those blocks take", async () => {
        // A slow round: block 103 is committed 20 s after the call.
        let head = 100
        setTimeout(() => { head = 101 }, 3_000)
        setTimeout(() => { head = 102 }, 6_000)
        setTimeout(() => { head = 103 }, 20_000)
        const calls = chain({ head: () => head, account: (height) => (height >= 103 ? AFTER : BEFORE) })
        const result = outcome(accountMarkAfterBlocks(ADDRESS))
        await vi.advanceTimersByTimeAsync(19_999)
        expect(result()).toBe("pending")
        await vi.advanceTimersByTimeAsync(2_001)
        expect(result()).toBe("8 4990000ugnot")
        // Every account read asked for block 103: seconds never stood in for blocks.
        expect(calls.filter((c) => c.method === "abci_query").every((c) => c.params.height === "103")).toBe(true)
    })

    it("sees a transfer included in the network's next block when the node answering was one block behind", async () => {
        const net = ticking(102)
        chain({ head: net.head, lag: 1, account: (height) => (height >= 103 ? AFTER : BEFORE) })
        const result = outcome(accountMarkAfterBlocks(ADDRESS))
        await vi.advanceTimersByTimeAsync(12_000)
        net.stop()
        expect(result()).toBe("8 4990000ugnot")
    })

    it.each([102, 103])("sees a transfer included in block %i when the node answering was at the head (100)", async (includedAt) => {
        const net = ticking(100)
        chain({ head: net.head, account: (height) => (height >= includedAt ? AFTER : BEFORE) })
        const result = outcome(accountMarkAfterBlocks(ADDRESS))
        await vi.advanceTimersByTimeAsync(12_000)
        net.stop()
        expect(result()).toBe("8 4990000ugnot")
    })

    it("refuses a head from a node two blocks behind, whose block time gives it away", async () => {
        // The case that would otherwise read a block older than the broadcast and call it unchanged.
        const net = ticking(102)
        const calls = chain({ head: net.head, lag: 2, account: (height) => (height >= 103 ? AFTER : BEFORE) })
        await expect(accountMarkAfterBlocks(ADDRESS)).rejects.toThrow("not recent")
        net.stop()
        expect(calls.some((c) => c.method === "abci_query")).toBe(false)
    })

    it.each([
        ["the oldest a head's block time can be (two intervals)", { sinceCommit: BLOCK_MS - 1 }, "pending"],
        ["a node one block behind at its oldest (three intervals)", { lag: 1, sinceCommit: BLOCK_MS - 300 }, "pending"],
        ["a block time from the future (this device's clock is behind)", { blockTime: () => new Date(Date.now() + 1_000).toISOString() }, "rejected: The node's last block is not recent"],
        ["a status without a readable block time", { blockTime: () => "" }, "rejected: The node's last block is not recent"],
    ])("judges the head by its block time: %s", async (_why, state, expected) => {
        chain({ head: () => 100, account: () => BEFORE, ...state })
        const result = outcome(accountMarkAfterBlocks(ADDRESS))
        await vi.advanceTimersByTimeAsync(1)
        expect(result()).toBe(expected)
    })

    it("gives up when the chain does not commit the next blocks in half a minute: a halt is not an answer", async () => {
        chain({ head: () => 100, account: () => BEFORE })
        const result = outcome(accountMarkAfterBlocks(ADDRESS))
        await vi.advanceTimersByTimeAsync(30_000)
        expect(result()).toBe("rejected: The chain did not commit the next blocks in time")
    })

    it("stops polling when told to", async () => {
        const calls = chain({ head: () => 100, account: () => BEFORE })
        const stop = new AbortController()
        const result = outcome(accountMarkAfterBlocks(ADDRESS, stop.signal))
        await vi.advanceTimersByTimeAsync(2_000)
        const reads = calls.length
        stop.abort()
        await vi.advanceTimersByTimeAsync(10_000)
        expect(result()).toBe("rejected: No longer needed")
        expect(calls.length).toBe(reads)
        expect(vi.getTimerCount()).toBe(0)
    })

    it.each([
        ["on another network", { network: "onyx-1" }],
        ["still catching up", { catchingUp: true }],
    ])("does not count blocks of a node that is %s", async (_why, state) => {
        chain({ head: () => 100, account: () => BEFORE, ...state })
        await expect(accountMarkAfterBlocks(ADDRESS)).rejects.toThrow("another network or not in sync")
    })
})
