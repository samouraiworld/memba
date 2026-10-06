import { beforeEach, describe, expect, it, vi } from "vitest"
import { weightedConfigSchema, weightedMembersSchema, weightedPageSchema, weightedProposalSchema, weightedAuthority, type WeightedProposal, type WeightedSnapshot } from "./weighted"
import v12Native from "./testdata/weighted-v12/native.json"

vi.mock("./weighted", async (original) => ({ ...(await original<typeof import("./weighted")>()), readWeightedSnapshot: vi.fn(), readWeightedProposal: vi.fn() }))
const { readWeightedProposal, readWeightedSnapshot } = await import("./weighted")
const { checkWeightedAction } = await import("./weightedActions")

const r = v12Native.records
const snapshot = () => ({ config: weightedConfigSchema.parse(r.config), members: weightedMembersSchema.parse(r.members).members, page: weightedPageSchema.parse(r.proposals_page_1) }) as WeightedSnapshot
const ctx = { rpcUrl: "https://rpc.invalid", chainId: "test-chain", realmPath: snapshot().config.realmPath }
const caller = snapshot().members[1].address
/** Proposal #4, here ready to execute. */
const ready = { ...weightedProposalSchema.parse(r.proposal_4).proposal, status: "READY", ready: true, qualified: true, votingClosed: true } as WeightedProposal
const check = (over: Partial<Parameters<typeof checkWeightedAction>[0]> = {}) =>
    checkWeightedAction({ ctx, caller, action: { type: "execute", id: "4" }, phase: "sign", reviewed: weightedAuthority(snapshot()), executes: ready.action, assertCurrent: () => {}, ...over })

beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(readWeightedSnapshot).mockImplementation(async () => snapshot())
    vi.mocked(readWeightedProposal).mockImplementation(async () => ready as Awaited<ReturnType<typeof readWeightedProposal>>)
})

describe("the checks a weighted action passes against fresh chain state", () => {
    it("words a changed roster for the step it happened in", async () => {
        const moved = snapshot()
        moved.members = moved.members.map((m, i) => i === 1 ? { ...m, finance: !m.finance } : m)
        vi.mocked(readWeightedSnapshot).mockResolvedValue(moved)
        await expect(check({ phase: "review" })).rejects.toThrow("DAO roster or roles changed; refresh and review again")
        await expect(check({ phase: "sign" })).rejects.toThrow("DAO roster or roles changed during confirmation; review again")
    })

    it("refuses an address that holds no seat", async () => {
        await expect(check({ caller: "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5" })).rejects.toThrow("Only current DAO members can act")
    })

    it("runs the caller's own check after every read", async () => {
        let reads = 0
        await check({ assertCurrent: () => { reads++ } })
        // Before the snapshot, after it, after the proposal.
        expect(reads).toBe(3)
        let calls = 0
        await expect(check({ assertCurrent: () => { if (++calls === 2) throw new Error("Wallet or page changed; prepare the action again") } })).rejects.toThrow("Wallet or page changed")
        // Stopped right after the snapshot: the proposal was read only by the first, complete check.
        expect(readWeightedProposal).toHaveBeenCalledTimes(1)
    })

    it("executes only a ready proposal that still holds the reviewed action, and returns what it will run", async () => {
        expect(await check()).toMatchObject({ executes: ready.action })
        vi.mocked(readWeightedProposal).mockResolvedValueOnce({ ...ready, status: "VOTING", ready: false, votingClosed: false } as Awaited<ReturnType<typeof readWeightedProposal>>)
        await expect(check()).rejects.toThrow("Proposal changed during confirmation; refresh")
        await expect(check({ executes: { ...ready.action, type: "feed" } as WeightedProposal["action"] })).rejects.toThrow("Proposal changed during confirmation; refresh")
    })
})
