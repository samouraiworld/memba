import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const address = "g1747t5m2f08plqjlrjk2q0qld7465hxz8gkx59c"
const kinds = vi.hoisted(() => ({ byPath: {} as Record<string, string | Error> }))
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

    it("counts only proposals from voteable DAO kinds", async () => {
        expect(await settle(scanUnvotedProposals(address))).toBe(1)
    })
})
