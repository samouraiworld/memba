import { beforeEach, describe, expect, it, vi } from "vitest"

const chain = vi.hoisted(() => ({
    config: { v2: { archived: false, electorate_version: 3 } } as { v2: { archived: boolean; electorate_version: number } } | null,
    members: [{ address: "g1member" }] as { address: string }[],
    proposal: { electorate_version: 3, open: true },
    voted: false as boolean | null,
}))

vi.mock("../../lib/dao", async (orig) => ({
    ...(await orig<typeof import("../../lib/dao")>()),
    getDAOConfig: vi.fn(async () => chain.config),
    getDAOMembers: vi.fn(async () => chain.members),
    getProposalDetail: vi.fn(async () => ({ status: chain.proposal.open ? "open" : "passed" })),
}))
vi.mock("../../lib/dao/membaV2", async (orig) => ({
    ...(await orig<typeof import("../../lib/dao/membaV2")>()),
    readV2Proposal: vi.fn(async () => ({ electorate_version: chain.proposal.electorate_version })),
}))
vi.mock("../../lib/dao/membaV2Shell", async (orig) => ({
    ...(await orig<typeof import("../../lib/dao/membaV2Shell")>()),
    hasVotedOnV2: vi.fn(async () => chain.voted),
}))
vi.mock("../../lib/dao/v2Lifecycle", async (orig) => ({
    ...(await orig<typeof import("../../lib/dao/v2Lifecycle")>()),
    canVoteNow: vi.fn(() => chain.proposal.open),
}))

import { voteRequest, type VoteContext } from "./voteRequest"
import type { ProposalView } from "./useOsDao"

const proposal: ProposalView = {
    id: 7, title: "Adopt the charter", description: "", statusLabel: "Active", open: true, yes: 0, no: 0, abstain: 0,
    whole: 10, unit: "power", tallyKnown: true, author: "g1author", endsAt: null, electorateVersion: 3, v2: null,
}
const ctx = (over: Partial<VoteContext> = {}): VoteContext => ({
    kind: "memba-v2", realmPath: "gno.land/r/alice/team", daoName: "Team", proposal, caller: "g1member", electorateVersion: 3, power: 2, ...over,
})

beforeEach(() => {
    chain.config = { v2: { archived: false, electorate_version: 3 } }
    chain.members = [{ address: "g1member" }]
    chain.proposal = { electorate_version: 3, open: true }
    chain.voted = false
})

describe("voteRequest · version-2 re-checks (as on the classic proposal page)", () => {
    it("passes when nothing changed", async () => {
        await expect(voteRequest(ctx()).recheck!("Yes")).resolves.toBeUndefined()
    })

    it.each([
        ["the DAO is archived", () => { chain.config = { v2: { archived: true, electorate_version: 3 } } }, "availability changed"],
        ["the member left", () => { chain.members = [] }, "membership"],
        ["the electorate changed", () => { chain.config = { v2: { archived: false, electorate_version: 4 } } }, "electorate changed"],
        ["the proposal's electorate differs", () => { chain.proposal.electorate_version = 2 }, "electorate changed"],
        ["the member already voted", () => { chain.voted = true }, "no longer available"],
        ["the vote read failed", () => { chain.voted = null }, "no longer available"],
        ["voting closed", () => { chain.proposal.open = false }, "no longer available"],
    ])("stops when %s", async (_what, change, message) => {
        change()
        await expect(voteRequest(ctx()).recheck!("Yes")).rejects.toThrow(message)
    })
})

describe("voteRequest · messages", () => {
    it("builds the version-2 Vote call with a deposit cap, and the choice follows the sheet", () => {
        const req = voteRequest(ctx())
        const yes = req.prepare("Yes").msgs[0]
        const no = req.prepare("No").msgs[0]
        expect(yes.value).toMatchObject({ func: "Vote", pkg_path: "gno.land/r/alice/team", caller: "g1member" })
        expect(yes.value.args).toContain("YES")
        expect(no.value.args).toContain("NO")
        expect(String(yes.value.max_deposit)).toMatch(/^\d+ugnot$/)
        expect(req.label("Abstain")).toBe("Vote Abstain on #7")
        expect(req.receipt).toMatchObject({ realmPath: "gno.land/r/alice/team", caller: "g1member", operation: "vote:7" })
    })

    it("uses GovDAO's own vote function, re-checking only that the proposal is open", async () => {
        const req = voteRequest(ctx({ kind: "govdao", realmPath: "gno.land/r/gov/dao", electorateVersion: null, power: null }))
        expect(req.prepare("No").msgs[0].value).toMatchObject({ func: "MustVoteOnProposalSimple", args: ["7", "NO"] })
        await expect(req.recheck!("No")).resolves.toBeUndefined()
        chain.proposal.open = false
        await expect(req.recheck!("No")).rejects.toThrow("no longer open")
        expect(req.verify).toBeUndefined()
    })
})
