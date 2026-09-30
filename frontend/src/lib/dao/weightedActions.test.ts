import { beforeEach, describe, expect, it, vi } from "vitest"
import { weightedConfigSchema, weightedMembersSchema, weightedPageSchema, weightedProposalSchema, weightedAuthority, type WeightedProposal, type WeightedSnapshot } from "./weighted"
import v12Native from "./testdata/weighted-v12/native.json"

vi.mock("./weighted", async (original) => ({ ...(await original<typeof import("./weighted")>()), readWeightedSnapshot: vi.fn(), readWeightedProposal: vi.fn(), readWeightedBallot: vi.fn(), readOpenWeightedProposals: vi.fn() }))
vi.mock("./weightedAcceptance", async (original) => ({ ...(await original<typeof import("./weightedAcceptance")>()), readTargetAuthority: vi.fn() }))
const { readOpenWeightedProposals, readWeightedProposal, readWeightedSnapshot } = await import("./weighted")
const { readTargetAuthority, weightedDaoAddress } = await import("./weightedAcceptance")
const { checkWeightedAction } = await import("./weightedActions")

const r = v12Native.records
const snapshot = () => ({ config: weightedConfigSchema.parse(r.config), members: weightedMembersSchema.parse(r.members).members, page: weightedPageSchema.parse(r.proposals_page_1) }) as WeightedSnapshot
const MEMBA_DAO = snapshot().config.realmPath
const ctx = { rpcUrl: "https://rpc.invalid", chainId: "gnoland-1", realmPath: MEMBA_DAO }
const caller = snapshot().members[1].address
const DAO = weightedDaoAddress(MEMBA_DAO)
const PUBLISHER = snapshot().config.marketPolicy.successor
/** Proposal #4 accepts the Market config admin role; here it is ready to execute. */
const acceptance = { ...weightedProposalSchema.parse(r.proposal_4).proposal, status: "READY", ready: true, qualified: true, votingClosed: true } as WeightedProposal
const check = (over: Partial<Parameters<typeof checkWeightedAction>[0]> = {}) =>
    checkWeightedAction({ ctx, caller, action: { type: "execute", id: "4" }, phase: "sign", reviewed: weightedAuthority(snapshot()), executes: acceptance.action, assertCurrent: () => {}, ...over })

beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(readWeightedSnapshot).mockImplementation(async () => snapshot())
    vi.mocked(readWeightedProposal).mockImplementation(async () => acceptance as Awaited<ReturnType<typeof readWeightedProposal>>)
    vi.mocked(readOpenWeightedProposals).mockResolvedValue([])
    vi.mocked(readTargetAuthority).mockResolvedValue({ current: PUBLISHER, pending: DAO, failed: [] })
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
        // Before the snapshot, after it, after the proposal, after the target's authority.
        expect(reads).toBe(4)
        let calls = 0
        await expect(check({ assertCurrent: () => { if (++calls === 3) throw new Error("Wallet or page changed; prepare the action again") } })).rejects.toThrow("Wallet or page changed")
        // Stopped right after the proposal read: the target was read only by the first, complete check.
        expect(readTargetAuthority).toHaveBeenCalledTimes(1)
    })

    it("executes an acceptance only while its target still names the DAO as pending, and returns what it will run", async () => {
        expect(await check()).toMatchObject({ executes: acceptance.action })
        vi.mocked(readTargetAuthority).mockResolvedValueOnce({ current: DAO, pending: "", failed: [] })
        await expect(check()).rejects.toThrow("The DAO already controls gno.land/r/samcrew/memba_market_config, so this acceptance would fail; refresh before acting")
        vi.mocked(readTargetAuthority).mockResolvedValueOnce({ current: PUBLISHER, pending: "", failed: [] })
        await expect(check()).rejects.toThrow("no longer names the DAO as its pending admin (pending: none)")
        vi.mocked(readTargetAuthority).mockResolvedValueOnce({ current: PUBLISHER, pending: DAO, failed: ["The attester is not set."] })
        await expect(check()).rejects.toThrow("would refuse this acceptance: The attester is not set.")
    })

    it("refuses to propose an acceptance while another one is open, or once the target is no longer nominated", async () => {
        const accept = { type: "accept", adapter: "marketPolicy" } as const
        vi.mocked(readOpenWeightedProposals).mockResolvedValueOnce([{ ...acceptance, id: "27", status: "VOTING" }])
        await expect(check({ action: accept, executes: undefined })).rejects.toThrow("Acceptance proposal #27 is still open")
        vi.mocked(readTargetAuthority).mockResolvedValueOnce({ current: DAO, pending: "", failed: [] })
        await expect(check({ action: accept, executes: undefined })).rejects.toThrow("is not ready for the DAO to accept (dao controls); refresh before acting")
        await expect(check({ action: accept, executes: undefined })).resolves.toMatchObject({ snapshot: expect.anything() })
    })
})
