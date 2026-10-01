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

    it("classifies a memba_feed call as a post event with a human verb", () => {
        const items = parseActivity([tx(110, "h10", [call("g1p", "gno.land/r/samcrew/memba_feed_v1", "CreatePost")])], new Map())
        expect(items[0].kind).toBe("post")
        expect(items[0].title).toBe("Posted on the feed")
    })

    it("classifies a memba_appstore call as an app event with a human verb", () => {
        const items = parseActivity([tx(111, "h11", [call("g1q", "gno.land/r/samcrew/memba_appstore_v2", "RegisterApp")])], new Map())
        expect(items[0].kind).toBe("app")
        expect(items[0].title).toBe("Submitted an app")
    })

    it("classifies a token_otc fill as a token trade", () => {
        const items = parseActivity([tx(112, "h12", [call("g1r", "gno.land/r/samcrew/memba_token_otc_v2", "Fill")])], new Map())
        expect(items[0].kind).toBe("token")
        expect(items[0].title).toBe("Traded tokens OTC")
    })

    it("maps MsgAddPackage to a deploy item with the package path", () => {
        const items = parseActivity([tx(104, "h5", [addpkg("g1f", "gno.land/r/demo/foo")])], new Map())
        expect(items[0]).toMatchObject({ kind: "deploy", actor: "g1f", pkgPath: "gno.land/r/demo/foo" })
    })

    it("maps BankMsgSend to a transfer item (actor = sender)", () => {
        const items = parseActivity([tx(105, "h6", [send("g1g", "g1h", "1000000ugnot")])], new Map())
        expect(items[0]).toMatchObject({ kind: "transfer", actor: "g1g" })
    })

    it("says whether the address it is about received or sent a transfer, with the exact amount", () => {
        const sent = send("g1g", "g1h", "1100000ugnot")
        expect(parseActivity([tx(105, "h6", [sent])], new Map(), { subject: "g1h" })[0])
            .toMatchObject({ kind: "transfer", title: "Received 1.1 GNOT", actor: "g1g", to: "g1h", direction: "received" })
        expect(parseActivity([tx(105, "h6", [sent])], new Map(), { subject: "g1g" })[0]).toMatchObject({ title: "Sent 1.1 GNOT" })
        // To itself: nothing arrives from anyone else.
        expect(parseActivity([tx(105, "h6", [send("g1g", "g1g", "1ugnot")])], new Map(), { subject: "g1g" })[0]).toMatchObject({ title: "Sent 0.000001 GNOT" })
        expect(parseActivity([tx(105, "h6", [send("g1g", "g1h", "5foo")])], new Map(), { subject: "g1h" })[0]).toMatchObject({ title: "Received 5foo" })
    })

    it("shows a chain-wide transfer in GNOT, as sent", () => {
        const [item] = parseActivity([tx(105, "h6", [send("g1g", "g1h", "1000000ugnot")])], new Map())
        expect(item.title).toBe("Sent 1 GNOT")
        expect(item.direction).toBeUndefined()
    })

    it("never shows a failed transaction", () => {
        const failed = { ...tx(105, "h6", [send("g1g", "g1h", "1000000ugnot")]), success: false }
        expect(parseActivity([failed], new Map(), { subject: "g1h" })).toEqual([])
    })

    it("gives every send naming the address its own row, whatever comes first in the transaction", () => {
        // A send between others first, then one to the address: the row is the one it received.
        const [received] = parseActivity([tx(105, "h6", [send("g1x", "g1y", "5ugnot"), send("g1y", "g1h", "7ugnot")])], new Map(), { subject: "g1h" })
        expect(received).toMatchObject({ title: "Received 0.000007 GNOT", actor: "g1y", msgIndex: 1, extraCount: 1 })
        // A multisig paying two people in one transaction: two rows.
        const two = parseActivity([tx(105, "h6", [send("g1h", "g1a", "1000000ugnot"), send("g1h", "g1b", "2000000ugnot")])], new Map(), { subject: "g1h" })
        expect(two.map((r) => [r.title, r.to, r.msgIndex])).toEqual([["Sent 1 GNOT", "g1a", 0], ["Sent 2 GNOT", "g1b", 1]])
        // A call before the send: the send is not hidden behind it.
        const mixed = parseActivity([tx(105, "h6", [call("g1h", "gno.land/r/x/a", "F"), send("g1h", "g1a", "3ugnot")])], new Map(), { subject: "g1h" })
        expect(mixed.map((r) => r.kind)).toEqual(["transfer", "call"])
    })

    it("drops a send it cannot read, never guessing a transfer", () => {
        for (const bad of [send("g1g", "", "5ugnot"), send("g1g", "g1h", ""), send("g1g", "g1h", "-5ugnot"), send("g1g", "g1h", "0ugnot"), send("g1g", "g1h", "five"), send("", "g1h", "5ugnot")]) {
            expect(parseActivity([tx(105, "h6", [bad])], new Map(), { subject: "g1h" })).toEqual([])
        }
    })

    it("formats a large ugnot amount exactly", () => {
        expect(parseActivity([tx(105, "h6", [send("g1g", "g1h", "9007199254740993ugnot")])], new Map(), { subject: "g1h" })[0].title).toBe("Received 9,007,199,254.740993 GNOT")
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

describe("parseActivity — diversity & humanized titles", () => {
    it("caps how many items one busy source contributes so a single realm can't flood the feed", () => {
        const txs: IndexerTx[] = []
        // 6 identical gov/dao Approve txs (newest-first by height) …
        for (let i = 0; i < 6; i++) txs.push(tx(200 - i, `g${i}`, [call("g1x", "gno.land/r/gov/dao", "Approve")]))
        // … plus two other sources crowded out today
        txs.push(tx(120, "d1", [addpkg("g1y", "gno.land/r/demo/foo")]))
        txs.push(tx(119, "t1", [send("g1z", "g1w", "5ugnot")]))

        const items = parseActivity(txs, new Map(), { limit: 12, maxPerSource: 2 })
        const approves = items.filter((i) => i.pkgPath === "gno.land/r/gov/dao" && i.func === "Approve")
        expect(approves).toHaveLength(2) // capped, not 6
        expect(items.some((i) => i.kind === "deploy")).toBe(true) // crowded-out source surfaces
        expect(items.some((i) => i.kind === "transfer")).toBe(true)
        expect(items[0].blockHeight).toBe(200) // newest-first order preserved
    })

    it("does not cap when maxPerSource is unset (by-address path keeps full history)", () => {
        const txs = Array.from({ length: 5 }, (_, i) => tx(50 - i, `h${i}`, [call("g1x", "gno.land/r/gov/dao", "Approve")]))
        expect(parseActivity(txs, new Map(), { limit: 12 })).toHaveLength(5)
    })

    it("humanizes a tokenfactory New as a token launch", () => {
        const items = parseActivity([tx(300, "h", [call("g1a", "gno.land/r/samcrew/tokenfactory_v2", "New")])], new Map())
        expect(items[0].kind).toBe("token")
        expect(items[0].title).toMatch(/launched a token/i)
    })

    it("labels a DAO-realm deployment as a DAO creation, not a bare deploy", () => {
        const items = parseActivity([tx(301, "h", [addpkg("g1a", "gno.land/r/samcrew/memba_dao")])], new Map())
        expect(items[0].kind).toBe("deploy")
        expect(items[0].title).toMatch(/created a dao/i)
    })

    it("verb-izes a governance vote and proposal", () => {
        const vote = parseActivity([tx(302, "h", [call("g1a", "gno.land/r/gov/dao", "VoteOnProposal")])], new Map())
        expect(vote[0].title).toMatch(/voted on governance/i)
        const propose = parseActivity([tx(303, "h", [call("g1a", "gno.land/r/gov/dao", "MustCreateProposal")])], new Map())
        expect(propose[0].title).toMatch(/proposed/i)
    })

    it("classifies NFT, on-chain post, and multisig realm calls into their own kinds", () => {
        const nft = parseActivity([tx(310, "h", [call("g1a", "gno.land/r/samcrew/memba_nft_market_v3", "Buy")])], new Map())
        expect(nft[0].kind).toBe("nft")
        const post = parseActivity([tx(311, "h", [call("g1a", "gno.land/r/demo/boards", "CreatePost")])], new Map())
        expect(post[0].kind).toBe("post")
        const ms = parseActivity([tx(312, "h", [call("g1a", "gno.land/r/samcrew/memba_multisig", "Execute")])], new Map())
        expect(ms[0].kind).toBe("multisig")
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
            // One alias per height asked: b0: getBlocks(where:{height:{eq:N}}).
            const data = Object.fromEntries([...q.matchAll(/(b\d+): getBlocks\(where:\{height:\{eq:(\d+)\}\}\)/g)]
                .map(([, alias, h]) => [alias, (opts.blocks ?? []).filter((b) => b.height === Number(h))]))
            return { ok: true, json: async () => ({ data }) } as Response
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

    it("asks only for successful transactions, only bank sends for transfers, and the times of exactly the blocks shown", async () => {
        const other = "g1747t5m2f08plqjlrjk2q0qld7465hxz8gkx59c"
        const fetchMock = mockIndexer({
            txs: [300, 100_000].map((h) => ({ hash: `h${h}`, block_height: h, messages: [{ value: { __typename: "BankMsgSend", from_address: other, to_address: ADDR, amount: "1ugnot" } }] })),
            blocks: [{ height: 300, time: "2026-10-01T10:00:00Z" }, { height: 100_000, time: "2026-10-01T11:00:00Z" }],
        })
        vi.stubGlobal("fetch", fetchMock)
        const items = await fetchAddressActivity(INDEXER, ADDR, { transfersOnly: true })
        const queries = fetchMock.mock.calls.map(([, init]) => (JSON.parse(String(init?.body)) as { query: string }).query)
        const txQuery = queries.find((q) => q.includes("transactions("))!
        expect(txQuery).toContain("success:true")
        expect(txQuery).not.toContain("caller:")
        expect(queries.find((q) => q.includes("getBlocks"))).not.toMatch(/gt:|lt:/)
        expect(items.map((i) => i.time)).toEqual(["2026-10-01T11:00:00Z", "2026-10-01T10:00:00Z"])
    })

    it("reads a transfer to the address as received", async () => {
        const other = "g1747t5m2f08plqjlrjk2q0qld7465hxz8gkx59c"
        vi.stubGlobal("fetch", mockIndexer({ txs: [{ hash: "in", block_height: 300, messages: [{ value: { __typename: "BankMsgSend", from_address: other, to_address: ADDR, amount: "1100000ugnot" } }] }] }))
        const [item] = await fetchAddressActivity(INDEXER, ADDR)
        expect(item).toMatchObject({ kind: "transfer", title: "Received 1.1 GNOT", actor: other, to: ADDR })
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
