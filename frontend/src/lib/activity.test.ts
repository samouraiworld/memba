/**
 * Tests for the recent-activity parser — maps tx-indexer GraphQL transactions
 * into honest, human-readable activity items. Fixtures mirror the real shape
 * returned by indexer.test13.testnets.gno.land (MsgCall / MsgAddPackage /
 * BankMsgSend / MsgRun / UnexpectedMessage).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { parseActivity, fetchAddressActivity, type IndexerTx } from "./activity"

const tx = (block_height: number, hash: string, messages: { value: Record<string, unknown> }[]): IndexerTx =>
    ({ hash, block_height, success: true, messages }) as IndexerTx
const call = (caller: string, pkg_path: string, func: string) =>
    ({ value: { __typename: "MsgCall", caller, pkg_path, func } })
const addpkg = (creator: string, path: string) =>
    ({ value: { __typename: "MsgAddPackage", creator, package: { path } } })
const send = (from_address: string, to_address: string, amount: string) =>
    ({ value: { __typename: "BankMsgSend", from_address, to_address, amount } })
const run = (caller: string) => ({ value: { __typename: "MsgRun", caller } })
const unknown = () => ({ value: { __typename: "UnexpectedMessage" } })

describe("parseActivity", () => {
    it("maps a MsgCall to a call item (actor, pkgPath, func, tx coords)", () => {
        const items = parseActivity([tx(100, "h1", [call("g1abc", "gno.land/r/gnoswap/gns", "Approve")])], new Map())
        expect(items).toHaveLength(1)
        expect(items[0]).toMatchObject({
            kind: "call", actor: "g1abc", pkgPath: "gno.land/r/gnoswap/gns",
            func: "Approve", txHash: "h1", blockHeight: 100,
        })
    })

    it("classifies a tokenfactory call as a token event", () => {
        const items = parseActivity([tx(101, "h2", [call("g1c", "gno.land/r/samcrew/tokenfactory_v2", "New")])], new Map())
        expect(items[0].kind).toBe("token")
    })

    it("classifies a valopers call as a validator event", () => {
        const items = parseActivity([tx(102, "h3", [call("g1d", "gno.land/r/gnops/valopers", "Register")])], new Map())
        expect(items[0].kind).toBe("validator")
    })

    it("classifies a gov/dao call as a governance event", () => {
        const items = parseActivity([tx(103, "h4", [call("g1e", "gno.land/r/gov/dao", "MustCreateProposal")])], new Map())
        expect(items[0].kind).toBe("governance")
    })

    it("maps MsgAddPackage to a deploy item with the package path", () => {
        const items = parseActivity([tx(104, "h5", [addpkg("g1f", "gno.land/r/demo/foo")])], new Map())
        expect(items[0]).toMatchObject({ kind: "deploy", actor: "g1f", pkgPath: "gno.land/r/demo/foo" })
    })

    it("maps BankMsgSend to a transfer item (actor = sender)", () => {
        const items = parseActivity([tx(105, "h6", [send("g1g", "g1h", "1000000ugnot")])], new Map())
        expect(items[0]).toMatchObject({ kind: "transfer", actor: "g1g" })
    })

    it("maps MsgRun to a run item", () => {
        const items = parseActivity([tx(106, "h7", [run("g1i")])], new Map())
        expect(items[0].kind).toBe("run")
    })

    it("summarizes a multi-message tx with an extraCount", () => {
        const items = parseActivity([tx(107, "h8", [
            call("g1j", "gno.land/r/x/a", "F"),
            call("g1j", "gno.land/r/x/b", "G"),
            call("g1j", "gno.land/r/x/c", "H"),
        ])], new Map())
        expect(items).toHaveLength(1)
        expect(items[0].extraCount).toBe(2)
    })

    it("orders newest block first and honors the limit", () => {
        const items = parseActivity(
            [tx(10, "old", [call("g1", "p", "F")]), tx(20, "new", [call("g1", "p", "G")])],
            new Map(), { limit: 1 },
        )
        expect(items).toHaveLength(1)
        expect(items[0].txHash).toBe("new")
    })

    it("attaches the block time from the height→time map when present", () => {
        const items = parseActivity([tx(30, "h9", [call("g1", "p", "F")])], new Map([[30, "2026-06-25T13:00:00Z"]]))
        expect(items[0].time).toBe("2026-06-25T13:00:00Z")
    })

    it("falls through to the first classifiable message when the first is unknown", () => {
        const items = parseActivity([tx(40, "h10", [unknown(), call("g1k", "gno.land/r/x/y", "Z")])], new Map())
        expect(items).toHaveLength(1)
        expect(items[0]).toMatchObject({ kind: "call", actor: "g1k", func: "Z" })
    })

    it("omits a tx whose messages are all unclassifiable (no throw)", () => {
        const items = parseActivity([tx(41, "h11", [unknown()])], new Map())
        expect(items).toEqual([])
    })

    it("never fabricates: an empty tx list yields no items", () => {
        expect(parseActivity([], new Map())).toEqual([])
    })
})

// ── fetchAddressActivity — by-address indexer reads ──────────────────────────

const INDEXER = "https://memba-backend.fly.dev/api/indexer"
const ADDR = "g1k7asng8uzf74xs0tsrfwytldl76hs4l3asglym"

/** Build a fetch mock that answers each GraphQL op by inspecting the query text.
 *  `txs` is what the `transactions` query returns (null models "no rows"). */
function mockIndexer(opts: {
    tip?: number
    txs?: IndexerTx[] | null
    blocks?: { height: number; time: string }[]
    transactionsError?: string
}) {
    return vi.fn(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as { query: string }
        const q = body.query
        if (q.includes("latestBlockHeight")) {
            return { ok: true, json: async () => ({ data: { latestBlockHeight: opts.tip ?? 463000 } }) } as Response
        }
        if (q.includes("transactions(")) {
            if (opts.transactionsError) {
                return { ok: true, json: async () => ({ errors: [{ message: opts.transactionsError }] }) } as Response
            }
            return { ok: true, json: async () => ({ data: { transactions: opts.txs ?? null } }) } as Response
        }
        if (q.includes("getBlocks")) {
            return { ok: true, json: async () => ({ data: { getBlocks: opts.blocks ?? [] } }) } as Response
        }
        throw new Error(`unexpected query: ${q}`)
    })
}

describe("fetchAddressActivity", () => {
    beforeEach(() => { vi.restoreAllMocks() })
    afterEach(() => { vi.restoreAllMocks() })

    it("maps the address's transactions to activity items, newest first, with times", async () => {
        const txs: IndexerTx[] = [
            { hash: "old", block_height: 100, messages: [{ value: { __typename: "MsgCall", caller: ADDR, pkg_path: "gno.land/r/x/a", func: "F" } }] },
            { hash: "new", block_height: 200, messages: [{ value: { __typename: "MsgAddPackage", creator: ADDR, package: { path: "gno.land/r/x/b" } } }] },
        ]
        const fetchMock = mockIndexer({ tip: 463000, txs, blocks: [{ height: 200, time: "2026-06-25T13:00:00Z" }] })
        vi.stubGlobal("fetch", fetchMock)

        const items = await fetchAddressActivity(INDEXER, ADDR)
        expect(items.map(i => i.txHash)).toEqual(["new", "old"]) // newest block first
        expect(items[0]).toMatchObject({ kind: "deploy", actor: ADDR, pkgPath: "gno.land/r/x/b", time: "2026-06-25T13:00:00Z" })
        expect(items[1]).toMatchObject({ kind: "call", actor: ADDR, func: "F" })
    })

    it("filters by the address across caller, creator, from_address and to_address (OR)", async () => {
        const fetchMock = mockIndexer({ txs: [] })
        vi.stubGlobal("fetch", fetchMock)
        await fetchAddressActivity(INDEXER, ADDR)

        // Find the body of the `transactions(` call and assert all positions are present.
        const txCall = fetchMock.mock.calls.find(c => JSON.parse(String(c[1]?.body)).query.includes("transactions("))!
        const q = JSON.parse(String(txCall[1]?.body)).query as string
        expect(q).toContain(`caller:"${ADDR}"`)
        expect(q).toContain(`creator:"${ADDR}"`)
        expect(q).toContain(`from_address:"${ADDR}"`)
        expect(q).toContain(`to_address:"${ADDR}"`)
        // windowed (bounded) — never an unbounded full-history scan
        expect(q).toMatch(/from_block_height:\d+/)
        expect(q).toMatch(/to_block_height:\d+/)
    })

    it("returns an empty list (no throw) when the indexer reports no rows (transactions: null)", async () => {
        vi.stubGlobal("fetch", mockIndexer({ txs: null }))
        await expect(fetchAddressActivity(INDEXER, ADDR)).resolves.toEqual([])
    })

    it("honors the limit, slicing to the newest N", async () => {
        const txs: IndexerTx[] = Array.from({ length: 30 }, (_, i) => ({
            hash: `h${i}`, block_height: 1000 + i,
            messages: [{ value: { __typename: "MsgCall", caller: ADDR, pkg_path: "p", func: "F" } }],
        }))
        vi.stubGlobal("fetch", mockIndexer({ txs }))
        const items = await fetchAddressActivity(INDEXER, ADDR, { limit: 5 })
        expect(items).toHaveLength(5)
        expect(items[0].blockHeight).toBe(1029) // newest
    })

    it("propagates a hard indexer error so the caller can retry", async () => {
        vi.stubGlobal("fetch", mockIndexer({ transactionsError: "boom" }))
        await expect(fetchAddressActivity(INDEXER, ADDR)).rejects.toThrow(/boom/)
    })

    it("still returns items when the timestamps (getBlocks) query fails", async () => {
        const txs: IndexerTx[] = [
            { hash: "h", block_height: 100, messages: [{ value: { __typename: "MsgCall", caller: ADDR, pkg_path: "p", func: "F" } }] },
        ]
        const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
            const q = JSON.parse(String(init?.body)).query as string
            if (q.includes("latestBlockHeight")) return { ok: true, json: async () => ({ data: { latestBlockHeight: 463000 } }) } as Response
            if (q.includes("transactions(")) return { ok: true, json: async () => ({ data: { transactions: txs } }) } as Response
            // getBlocks fails hard
            return { ok: false, status: 500, json: async () => ({}) } as Response
        })
        vi.stubGlobal("fetch", fetchMock)
        const items = await fetchAddressActivity(INDEXER, ADDR)
        expect(items).toHaveLength(1)
        expect(items[0].time).toBeUndefined()
    })

    it("does not query the indexer for a malformed address", async () => {
        const fetchMock = mockIndexer({ txs: [] })
        vi.stubGlobal("fetch", fetchMock)
        await expect(fetchAddressActivity(INDEXER, "not-an-address")).resolves.toEqual([])
        expect(fetchMock).not.toHaveBeenCalled()
    })
})
