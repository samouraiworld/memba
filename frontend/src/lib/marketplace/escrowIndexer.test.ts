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
    findFreelancerContractIds,
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
        expect(parseFreelancerContracts(data, ESCROW, FREELANCER)).toHaveLength(20)
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

describe("findFreelancerContractIds", () => {
    it("POSTs the bounded query to the indexer and parses the answer", async () => {
        const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: { transactions: [tx(created("9"))] } }), { status: 200 }))
        vi.stubGlobal("fetch", fetchMock)
        expect(await findFreelancerContractIds("https://api.example/api/indexer", "gnoland-1", ESCROW, FREELANCER)).toEqual(["9"])
        const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
        expect(url).toBe("https://api.example/api/indexer")
        expect(JSON.parse(String(init.body)).query).toContain("from_block_height:299934")
    })

    it("surfaces an indexer error", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ errors: [{ message: "boom" }] }), { status: 200 })))
        await expect(findFreelancerContractIds("https://api.example/api/indexer", "gnoland-1", ESCROW, FREELANCER)).rejects.toThrow("boom")
    })
})
