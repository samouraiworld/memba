import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const address = "g1747t5m2f08plqjlrjk2q0qld7465hxz8gkx59c"
const calls = vi.hoisted(() => ({ proposals: vi.fn(), votes: vi.fn() }))
vi.mock("./members", () => ({ getDAOMembers: async () => [{ address }] }))
vi.mock("./proposals", () => ({ getDAOProposals: calls.proposals, getProposalVotes: calls.votes }))
vi.mock("./config", () => ({ getDAOConfig: async () => ({}) }))
vi.mock("../profile", () => ({ resolveOnChainUsername: async () => "" }))
vi.mock("../daoSlug", () => ({
    getSavedDAOs: () => [], FEATURED_DAO: { realmPath: "gno.land/r/example/dao", name: "DAO" }, encodeSlug: (path: string) => path,
}))

async function onChain(chain: string) {
    // The application reloads modules when switching networks; sessionStorage survives.
    vi.resetModules()
    vi.doMock("../config", () => ({ GNO_RPC_URL: `rpc:${chain}`, networkScopedKey: (base: string) => `${base}::${chain}` }))
    calls.proposals.mockImplementation(async (rpc: string) => [{ id: 1, title: `Decision on ${rpc}`, status: "open" }])
    return import("./voteScanner")
}

async function settle<T>(promise: Promise<T>): Promise<T> {
    await vi.runAllTimersAsync()
    return promise
}

beforeEach(() => {
    vi.useFakeTimers()
    sessionStorage.clear()
    vi.clearAllMocks()
    calls.votes.mockResolvedValue([{ yesVoters: [], noVoters: [], abstainVoters: [] }])
})
afterEach(() => { vi.useRealTimers(); vi.doUnmock("../config") })

const scans = [
    ["scanUnvotedProposals", "memba_unvoted_cache"],
    ["scanUnvotedProposalDetails", "memba_unvoted_details_cache"],
    ["scanMyVotes", "memba_myvotes_cache"],
] as const

describe("vote scanner network isolation", () => {
    it.each(scans)("%s rescans a different chain but reuses same-chain cache", async (method, key) => {
        if (method === "scanMyVotes") calls.votes.mockResolvedValue([{ yesVoters: [{ username: address }], noVoters: [], abstainVoters: [] }])
        const pearl = await onChain("pearl")
        const first = await settle(pearl[method](address))
        expect(calls.proposals).toHaveBeenCalledTimes(1)
        const mainnet = await onChain("gnoland-1")
        const second = await settle(mainnet[method](address))
        expect(calls.proposals).toHaveBeenCalledTimes(2)
        expect(calls.proposals).toHaveBeenLastCalledWith("rpc:gnoland-1", "gno.land/r/example/dao")
        if (method !== "scanUnvotedProposals") {
            expect(JSON.stringify(first)).toContain("Decision on rpc:pearl")
            expect(JSON.stringify(second)).toContain("Decision on rpc:gnoland-1")
            expect(JSON.stringify(second)).not.toContain("Decision on rpc:pearl")
        }
        expect(await mainnet[method](address)).toEqual(second)
        expect(calls.proposals).toHaveBeenCalledTimes(2)
        expect(sessionStorage.getItem(`${key}::pearl::${address}`)).not.toBeNull()
        expect(sessionStorage.getItem(`${key}::gnoland-1::${address}`)).not.toBeNull()
    })

    it.each(scans)("%s ignores legacy unscoped cache entries", async (method, key) => {
        sessionStorage.setItem(key, JSON.stringify({ data: method === "scanUnvotedProposals" ? 99 : [{ proposalTitle: "Wrong network" }], ts: Date.now() }))
        const scanner = await onChain("gnoland-1")
        const result = await settle(scanner[method](address))
        expect(calls.proposals).toHaveBeenCalledTimes(1)
        expect(JSON.stringify(result)).not.toContain("Wrong network")
        expect(result).not.toBe(99)
    })

    it("clears all active-chain caches and notifies subscribers", async () => {
        const scanner = await onChain("gnoland-1")
        for (const [,key] of scans) {
            sessionStorage.setItem(`${key}::gnoland-1::${address}`, "current")
            sessionStorage.setItem(`${key}::gnoland-1::g1otherwallet`, "current")
            sessionStorage.setItem(`${key}::pearl::${address}`, "other")
        }
        const listener = vi.fn()
        window.addEventListener("memba:voteCacheCleared", listener)
        try {
            scanner.clearVoteCache()
            for (const [,key] of scans) {
                expect(sessionStorage.getItem(`${key}::gnoland-1::${address}`)).toBeNull()
                expect(sessionStorage.getItem(`${key}::gnoland-1::g1otherwallet`)).toBeNull()
                expect(sessionStorage.getItem(`${key}::pearl::${address}`)).toBe("other")
            }
            expect(listener).toHaveBeenCalledTimes(1)
        } finally { window.removeEventListener("memba:voteCacheCleared", listener) }
    })

    it.each(scans)("%s never serves one wallet's cached result to another wallet", async (method, key) => {
        const other = "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5"
        const sentinel = method === "scanUnvotedProposals" ? 42 : [{ proposalTitle: "Cached for the first wallet" }]
        sessionStorage.setItem(`${key}::gnoland-1::${address}`, JSON.stringify({ data: sentinel, ts: Date.now() }))
        const scanner = await onChain("gnoland-1")
        expect(await scanner[method](address)).toEqual(sentinel)
        const forOther = await settle(scanner[method](other))
        expect(forOther).not.toEqual(sentinel)
    })
})
