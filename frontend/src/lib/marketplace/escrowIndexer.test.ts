/**
 * escrowIndexer — freelancer discovery through the tx-indexer's ContractCreated
 * events: the query only interpolates checked values, starts at the realm's
 * publish height, and the parser keeps only this realm's events naming this
 * freelancer, refusing a malformed answer.
 */
import { afterEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import {
    ESCROW_PUBLISH_HEIGHTS,
    EscrowIndexerError,
    escrowScanFromHeight,
    FREELANCER_WINDOW_BLOCKS,
    findFreelancerContractsPage,
    freelancerContractsQuery,
    parseFreelancerContracts,
} from "./escrowIndexer"

const CLIENT = "g1747t5m2f08plqjlrjk2q0qld7465hxz8gkx59c"
const FREELANCER = "g1u7y667z64x2h7vc6fmpcprgey4ck233jaww9zq"
const ESCROW = "gno.land/r/samcrew/escrow_v4"

const created = (id: string, freelancer = FREELANCER, pkg = ESCROW) => ({
    type: "ContractCreated",
    pkg_path: pkg,
    attrs: [{ key: "id", value: id }, { key: "client", value: CLIENT }, { key: "freelancer", value: freelancer }, { key: "milestones", value: "1" }],
})
const tx = (...events: unknown[]) => ({ response: { events } })

afterEach(() => { vi.unstubAllGlobals() })

describe("freelancerContractsQuery", () => {
    it("filters successful transactions by this realm's ContractCreated event and the freelancer attribute, from a start height", () => {
        const q = freelancerContractsQuery(ESCROW, FREELANCER, 299_934)
        expect(q).toContain("from_block_height:299934")
        expect(q).toContain("success:true")
        expect(q).toContain(`gno_event:{ pkg_path:"${ESCROW}", type:"ContractCreated", attrs:[{ key:"freelancer", value:"${FREELANCER}" }] }`)
    })

    it("interpolates only a realm path, a checksummed address and a positive height", () => {
        expect(() => freelancerContractsQuery(`${ESCROW}" } }] }) { x`, FREELANCER)).toThrow(/realm path/)
        expect(() => freelancerContractsQuery(ESCROW, 'g1" }] } }')).toThrow(/freelancer address/)
        expect(() => freelancerContractsQuery(ESCROW, "g1u7y667z64x2h7vc6fmpcprgey4ck233jaww9zr")).toThrow(/freelancer address/)
        expect(() => freelancerContractsQuery(ESCROW, FREELANCER, 0)).toThrow(/start height/)
        expect(() => freelancerContractsQuery(ESCROW, FREELANCER, 10, 9)).toThrow(/end height/)
        expect(freelancerContractsQuery(ESCROW, FREELANCER, 10, 20)).toContain("from_block_height:10, to_block_height:20,")
    })

    it("starts at the realm's publish height as recorded in realm-versions.json", () => {
        const root = join(dirname(fileURLToPath(import.meta.url)), "../../../..")
        const versions = JSON.parse(readFileSync(join(root, "realm-versions.json"), "utf8")) as Record<string, Record<string, { path: string; height: number }>>
        const byChain: Record<string, string> = { "gnoland-1": "mainnet" }
        for (const [chainId, realms] of Object.entries(ESCROW_PUBLISH_HEIGHTS)) {
            for (const [path, height] of Object.entries(realms)) {
                const record = Object.values(versions[byChain[chainId]]).find((r) => r.path === path)
                expect(record?.height, `${chainId} ${path}`).toBe(height)
            }
        }
        expect(escrowScanFromHeight("gnoland-1", ESCROW)).toBe(299_934)
        expect(escrowScanFromHeight("test-13", ESCROW)).toBe(1)
    })
})

describe("parseFreelancerContracts", () => {
    it("returns this realm's contracts naming the freelancer, newest first, without duplicates", () => {
        const data = { transactions: [tx(created("3"), {}), tx({}, created("12")), tx(created("3"))] }
        expect(parseFreelancerContracts(data, ESCROW, FREELANCER)).toEqual(["12", "3"])
    })

    it("ignores other events, other realms and other freelancers in the same transactions", () => {
        const data = { transactions: [tx(
            created("1", CLIENT),
            created("2", FREELANCER, "gno.land/r/samcrew/escrow_v3"),
            { type: "MilestoneFunded", pkg_path: ESCROW, attrs: [{ key: "contractId", value: "4" }] },
            created("5"),
        )] }
        expect(parseFreelancerContracts(data, ESCROW, FREELANCER)).toEqual(["5"])
    })

    it("reads no match as an empty list", () => {
        expect(parseFreelancerContracts({ transactions: null }, ESCROW, FREELANCER)).toEqual([])
        expect(parseFreelancerContracts({ transactions: [] }, ESCROW, FREELANCER)).toEqual([])
        expect(parseFreelancerContracts({ transactions: [{ response: { events: null } }] }, ESCROW, FREELANCER)).toEqual([])
    })

    it("keeps at most the newest `max`", () => {
        const data = { transactions: Array.from({ length: 30 }, (_, i) => tx(created(String(i)))) }
        expect(parseFreelancerContracts(data, ESCROW, FREELANCER, 3)).toEqual(["29", "28", "27"])
        expect(parseFreelancerContracts(data, ESCROW, FREELANCER)).toHaveLength(10)
    })

    it.each([
        ["no data", null],
        ["transactions", { transactions: {} }],
        ["events", { transactions: [{ response: { events: "x" } }] }],
        ["event", { transactions: [tx(null)] }],
        ["event attributes", { transactions: [tx({ type: "ContractCreated", pkg_path: ESCROW, attrs: null })] }],
        ["contract id", { transactions: [tx({ ...created("x"), attrs: [{ key: "id", value: "07" }, { key: "freelancer", value: FREELANCER }] })] }],
        ["contract id", { transactions: [tx({ ...created("1"), attrs: [{ key: "id", value: "1" }, { key: "id", value: "2" }, { key: "freelancer", value: FREELANCER }] })] }],
    ])("refuses a malformed answer (%s)", (what, data) => {
        expect(() => parseFreelancerContracts(data, ESCROW, FREELANCER)).toThrow(EscrowIndexerError)
        expect(() => parseFreelancerContracts(data, ESCROW, FREELANCER)).toThrow(what)
    })
})

describe("findFreelancerContractsPage", () => {
    const TIP = 700_000
    const FLOOR = 299_934
    /** A fake indexer: contracts created at the given heights (id i at heights[i]); records every query's window. */
    const indexer = (heights: number[]) => {
        const windows: [number, number][] = []
        const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
            const q = JSON.parse(String(init.body)).query as string
            if (q.includes("latestBlockHeight")) return new Response(JSON.stringify({ data: { latestBlockHeight: TIP } }))
            const from = Number(/from_block_height:(\d+)/.exec(q)![1])
            const to = Number(/to_block_height:(\d+)/.exec(q)![1])
            windows.push([from, to])
            const txs = heights.map((h, id) => ({ h, id })).filter(({ h }) => h >= from && h <= to).map(({ id }) => tx(created(String(id))))
            return new Response(JSON.stringify({ data: { transactions: txs.length ? txs : null } }))
        })
        vi.stubGlobal("fetch", fetchMock)
        return windows
    }
    const page = (cursor: Parameters<typeof findFreelancerContractsPage>[4]) =>
        findFreelancerContractsPage("https://api.example/api/indexer", "gnoland-1", ESCROW, FREELANCER, cursor)

    it("scans newest first in bounded windows, never below the publish height", async () => {
        const windows = indexer([])
        const p = await page(null)
        expect(p.ids).toEqual([])
        expect(windows).toEqual([[500_001, TIP], [300_001, 500_000], [FLOOR, 300_000]])
        expect(p.next).toBeNull()
        for (const [from, to] of windows) expect(to - from + 1).toBeLessThanOrEqual(FREELANCER_WINDOW_BLOCKS)
    })

    it("returns at most 10 ids per page and resumes below the last one shown", async () => {
        // 25 contracts in the newest window, ids 0..24 (id 24 newest).
        const heights = Array.from({ length: 25 }, (_, i) => TIP - 1_000 + i)
        indexer(heights)
        const first = await page(null)
        expect(first.ids).toEqual(["24", "23", "22", "21", "20", "19", "18", "17", "16", "15"])
        expect(first.next).toEqual({ top: TIP, belowId: 15 })
        const second = await page(first.next)
        expect(second.ids).toEqual(["14", "13", "12", "11", "10", "9", "8", "7", "6", "5"])
        const third = await page(second.next)
        expect(third.ids).toEqual(["4", "3", "2", "1", "0"])
        expect(third.next).toBeNull()
    })

    it("stops after a bounded number of windows and hands back a cursor", async () => {
        vi.stubGlobal("fetch", vi.fn(async (_u: string, init: RequestInit) => {
            const q = JSON.parse(String(init.body)).query as string
            return new Response(JSON.stringify({ data: q.includes("latestBlockHeight") ? { latestBlockHeight: 2_000_000 } : { transactions: null } }))
        }))
        const p = await page(null)
        expect(p.ids).toEqual([])
        expect(p.next).toEqual({ top: 2_000_000 - 4 * FREELANCER_WINDOW_BLOCKS, belowId: null })
    })

    it("surfaces an indexer or proxy error", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 502 })))
        await expect(page(null)).rejects.toThrow("indexer HTTP 502")
        vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ errors: [{ message: "boom" }] }), { status: 200 })))
        await expect(page({ top: TIP, belowId: null })).rejects.toThrow("boom")
    })
})
