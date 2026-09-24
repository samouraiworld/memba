import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const address = "g1747t5m2f08plqjlrjk2q0qld7465hxz8gkx59c"
const kinds = vi.hoisted(() => ({ byPath: {} as Record<string, string | Error> }))
const pending = vi.hoisted(() => ({ pages: [] as unknown[], calls: [] as unknown[][] }))
vi.mock("./weighted", async (orig) => ({
    ...(await orig<typeof import("./weighted")>()),
    readWeightedPendingVotes: async (...args: unknown[]) => {
        pending.calls.push(args)
        const page = pending.pages.shift()
        if (page instanceof Error || page === undefined) throw page ?? new Error("no ballot read")
        return page
    },
}))
vi.mock("./members", () => ({ getDAOMembers: async () => [{ address }] }))
vi.mock("./proposals", () => ({
    getDAOProposals: async (_rpc: string, path: string) => [{ id: 1, title: `Open on ${path}`, status: "open" }],
    getProposalVotes: async () => [{ yesVoters: [], noVoters: [], abstainVoters: [] }],
}))
vi.mock("./config", () => ({ getDAOConfig: async () => ({}) }))
vi.mock("../profile", () => ({ resolveOnChainUsername: async () => "" }))
vi.mock("../config", async (orig) => ({ ...(await orig<typeof import("../config")>()), GNO_RPC_URL: "rpc", GNO_CHAIN_ID: "pearl-1", networkScopedKey: (base: string) => `${base}::pearl-1` }))
vi.mock("../daoSlug", () => ({
    getSavedDAOs: () => [
        { realmPath: "gno.land/r/alice/voteable", name: "Voteable", addedAt: 1 },
        { realmPath: "gno.land/r/alice/unresolved", name: "Unresolved", addedAt: 2 },
    ],
    FEATURED_DAO: { realmPath: "gno.land/r/samcrew/memba_dao", name: "Read-only" },
    encodeSlug: (path: string) => path,
}))
vi.mock("./kind", async (orig) => ({
    ...(await orig<typeof import("./kind")>()),
    resolveDaoKind: async ({ realmPath }: { realmPath: string }) => {
        const kind = kinds.byPath[realmPath]
        if (kind instanceof Error) throw kind
        return kind
    },
}))

import { scanUnvotedProposalDetails, scanUnvotedProposals } from "./voteScanner"
import native from "./testdata/weighted-v12/native.json"
import { weightedProposalSchema } from "./weighted"

const weighted = { records: {
    op_first: weightedProposalSchema.parse(native.records["op:market-config:set-fee-live"]).proposal,
    op_second: { id: String(Number(native.records["op:market-config:set-fee-live"].proposal.id) - 1), unreadable: true as const },
} }

async function settle<T>(promise: Promise<T>): Promise<T> {
    await vi.runAllTimersAsync()
    return promise
}

describe("Quick Vote offers only DAOs whose contract accepts votes from Memba", () => {
    beforeEach(() => {
        vi.useFakeTimers()
        sessionStorage.clear()
        kinds.byPath = {
            "gno.land/r/samcrew/memba_dao": "daokit",
            "gno.land/r/alice/voteable": "memba-v1",
            "gno.land/r/alice/unresolved": new Error("RPC down"),
        }
    })
    afterEach(() => vi.useRealTimers())

    it("lists only proposals from voteable DAO kinds", async () => {
        const details = await settle(scanUnvotedProposalDetails(address))
        expect(details.map((d) => d.realmPath)).toEqual(["gno.land/r/alice/voteable"])
    })

    it("lists a weighted DAO's own pending proposals as read-only indicators, following a scan-capped cursor", async () => {
        kinds.byPath["gno.land/r/samcrew/memba_dao"] = "weighted"
        const items = [weighted.records.op_first, weighted.records.op_second]
        pending.pages = [{ voter: address, items: [], next: "92" }, { voter: address, items, next: null }]
        pending.calls = []
        const details = await settle(scanUnvotedProposalDetails(address))
        expect(pending.calls.map(c => c[2])).toEqual(["0", "92"])
        const listed = details.filter(d => d.realmPath === "gno.land/r/samcrew/memba_dao")
        expect(listed.map(d => [d.proposalId, d.readOnly, d.href, d.proposalTitle])).toEqual([
            [items[0].id, true, `/weighted-dao/gno.land/r/samcrew/memba_dao#proposal-${items[0].id}`, "Market config · set-fee"],
            [items[1].id, true, `/weighted-dao/gno.land/r/samcrew/memba_dao#proposal-${items[1].id}`, "Unreadable proposal #" + items[1].id],
        ])
    })

    it("keeps weighted uint64 IDs exact above 2^53", async () => {
        kinds.byPath["gno.land/r/samcrew/memba_dao"] = "weighted"
        const huge = "18446744073709551615"
        pending.pages = [{ voter: address, items: [{ id: huge, unreadable: true }], next: null }]
        const details = await settle(scanUnvotedProposalDetails(address))
        const row = details.find(d => d.realmPath === "gno.land/r/samcrew/memba_dao")!
        expect(row.proposalId).toBe(huge)
        expect(row.href).toBe(`/weighted-dao/gno.land/r/samcrew/memba_dao#proposal-${huge}`)
        expect(row.proposalTitle).toBe(`Unreadable proposal #${huge}`)
    })

    it("contributes nothing when a weighted DAO has no ballot reads", async () => {
        kinds.byPath["gno.land/r/samcrew/memba_dao"] = "weighted"
        pending.pages = [new Error("GetPendingVotesJSON not declared")]
        const details = await settle(scanUnvotedProposalDetails(address))
        expect(details.map((d) => d.realmPath)).toEqual(["gno.land/r/alice/voteable"])
    })

    it("counts only proposals from voteable DAO kinds", async () => {
        expect(await settle(scanUnvotedProposals(address))).toBe(1)
    })
})
