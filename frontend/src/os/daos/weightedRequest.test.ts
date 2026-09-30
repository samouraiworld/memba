import { beforeEach, describe, expect, it, vi } from "vitest"
import { weightedConfigSchema, weightedMembersSchema, weightedPageSchema, WEIGHTED_APPLICATIONS_SCHEMA, type WeightedBallot, type WeightedProposal, type WeightedSnapshot } from "../../lib/dao/weighted"
import { weightedFixture } from "../../lib/dao/testdata/weighted"
import v12Native from "../../lib/dao/testdata/weighted-v12/native.json"
import { v12CallBudget, v12ExecuteBudget } from "../../lib/dao/weightedBudget"
import { formatUgnotExact } from "../../lib/dao/v2Budget"

vi.mock("../../lib/dao/weighted", async (original) => ({ ...(await original<typeof import("../../lib/dao/weighted")>()), readWeightedSnapshot: vi.fn(), readWeightedProposal: vi.fn(), readWeightedBallot: vi.fn() }))
vi.mock("../../lib/dao/weightedWallet", () => ({ assertLiveWalletChain: vi.fn() }))
vi.mock("../../lib/grc20", async (original) => ({ ...(await original<typeof import("../../lib/grc20")>()), doContractBroadcast: vi.fn(), freshFeeForGasWanted: vi.fn() }))
const { readWeightedBallot, readWeightedProposal, readWeightedSnapshot } = await import("../../lib/dao/weighted")
const { assertLiveWalletChain } = await import("../../lib/dao/weightedWallet")
const { doContractBroadcast, freshFeeForGasWanted, FALLBACK_GAS_PRICE, feeForGasWanted } = await import("../../lib/grc20")
const { weightedExecuteRequest, weightedVoteOptions, weightedVoteRequest } = await import("./weightedRequest")

const MEMBA_DAO = "gno.land/r/samcrew/memba_dao"
const r = v12Native.records
const snapshot = () => ({ config: weightedConfigSchema.parse(r.config), members: weightedMembersSchema.parse(r.members).members, page: weightedPageSchema.parse(r.proposals_page_1) }) as WeightedSnapshot
const proposal = (id: string) => snapshot().page.proposals.find((p) => p.id === id) as WeightedProposal
const MIKAEL = snapshot().members[1].address
/** The price quoted at the review: 1 ugnot per 1,000 gas. */
const PRICE = { gas: 1000, ugnot: 1 }
const ctx = (id = "17", over: Partial<WeightedSnapshot> = {}) => ({ realmPath: MEMBA_DAO, daoName: "Memba DAO", snapshot: { ...snapshot(), ...over }, proposal: proposal(id), caller: MIKAEL, gasPrice: PRICE })
const ballot = (over: Partial<WeightedBallot> = {}): WeightedBallot => ({ schema: WEIGHTED_APPLICATIONS_SCHEMA, proposalId: "17", voter: MIKAEL, eligible: true, choice: null, votedAtHeight: null, ...over })
const HASH = "a".repeat(64)

beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(readWeightedSnapshot).mockImplementation(async () => snapshot())
    vi.mocked(readWeightedProposal).mockImplementation(async (_ctx, id) => proposal(id) as Awaited<ReturnType<typeof readWeightedProposal>>)
    vi.mocked(readWeightedBallot).mockImplementation(async (_ctx, proposalId, voter) => ballot({ proposalId, voter }))
    vi.mocked(assertLiveWalletChain).mockResolvedValue({ chainId: "gnoland-1" } as Awaited<ReturnType<typeof assertLiveWalletChain>>)
    vi.mocked(doContractBroadcast).mockImplementation(async (_msgs, _memo, opts) => { await opts?.beforeSign?.(); return { hash: HASH } })
    vi.mocked(freshFeeForGasWanted).mockImplementation(async (gasWanted) => feeForGasWanted(gasWanted, PRICE))
})

describe("a weighted vote as a signing request", () => {
    it("offers the given choices and signs exactly the vote call, with the measured budget", () => {
        const req = weightedVoteRequest(ctx(), ["No", "Abstain"])
        expect(req.summary).toBe("Vote on #17 “Market config · Set a fee”")
        expect(req.choice).toEqual({ label: "Your vote", options: ["No", "Abstain"], initial: "No" })
        const budget = v12CallBudget("Vote")
        expect(req.prepare("Abstain").msgs).toEqual([{ type: "vm/MsgCall", value: { caller: MIKAEL, send: "", pkg_path: MEMBA_DAO, func: "Vote", args: ["17", "abstain"], max_deposit: `${budget.maxDepositUgnot}ugnot` } }])
        expect(req.lines("No")).toEqual([
            ["Your vote", "No"], ["Your voting points", "1 of 8"],
            ["Storage deposit", expect.stringMatching(/^up to [\d.]+ GNOT$/)], ["Network fee", formatUgnotExact(feeForGasWanted(budget.gasWanted, PRICE))],
            ["Gas limit", budget.gasWanted.toLocaleString("en-US")], ["Network", "gnoland-1"],
        ])
        expect(req.note).toBe("You can change your vote until voting closes, unless the proposal is executed or invalidated first.")
        expect(req.receipt).toEqual({ chainId: "gnoland-1", realmPath: MEMBA_DAO, caller: MIKAEL, operation: "weighted-vote:17" })
        expect(req.label("No")).toBe("Vote No on #17")
    })

    it("sends through the shared broadcaster once and runs the fresh checks before the wallet opens", async () => {
        const req = weightedVoteRequest(ctx(), ["Yes", "No", "Abstain"])
        const beforeSign = vi.fn(async () => { await req.recheck!("No") })
        expect(await req.send("No", beforeSign)).toEqual({ hash: HASH })
        const [msgs, memo, opts] = vi.mocked(doContractBroadcast).mock.calls[0]
        expect(msgs).toEqual(req.prepare("No").msgs)
        expect(memo).toBe("vote no on weighted proposal 17")
        // The wallet gets the fee the member reviewed, not a later quote.
        expect(opts).toMatchObject({ gasWanted: v12CallBudget("Vote").gasWanted, gasFee: feeForGasWanted(v12CallBudget("Vote").gasWanted, PRICE) })
        expect(beforeSign).toHaveBeenCalledTimes(1)
        expect(readWeightedBallot).toHaveBeenCalledWith(expect.objectContaining({ chainId: "gnoland-1", realmPath: MEMBA_DAO }), "17", MIKAEL)
        expect(assertLiveWalletChain).toHaveBeenCalledWith({ chainId: "gnoland-1", address: MIKAEL, schema: WEIGHTED_APPLICATIONS_SCHEMA, realmPath: MEMBA_DAO })
    })

    it("refuses to sign when the roster, the proposal or the ballot changed since the review, or the wallet is elsewhere", async () => {
        const req = weightedVoteRequest(ctx(), ["Yes", "No", "Abstain"])
        const moved = snapshot()
        moved.members = moved.members.map((m, i) => i === 1 ? { ...m, admin: !m.admin } : m)
        vi.mocked(readWeightedSnapshot).mockResolvedValueOnce(moved)
        await expect(req.recheck!("No")).rejects.toThrow("DAO roster or roles changed during confirmation; review again")
        vi.mocked(readWeightedProposal).mockResolvedValueOnce({ ...proposal("17"), votingClosed: true } as Awaited<ReturnType<typeof readWeightedProposal>>)
        await expect(req.recheck!("No")).rejects.toThrow("Proposal changed during confirmation; refresh")
        vi.mocked(readWeightedBallot).mockResolvedValueOnce(ballot({ choice: "no", votedAtHeight: "9" }))
        await expect(req.recheck!("No")).rejects.toThrow("You already voted no; the same ballot again would change nothing")
        vi.mocked(assertLiveWalletChain).mockRejectedValueOnce(new Error("Your wallet is on test13, not gnoland-1"))
        await expect(req.recheck!("No")).rejects.toThrow("Your wallet is on test13, not gnoland-1")
        await expect(req.recheck!("No")).resolves.toBeUndefined()
    })

    it("calls the fee an estimate when the price could not be read, and refuses to sign when a fresh quote is higher or unreadable", async () => {
        const estimated = weightedVoteRequest({ ...ctx(), gasPrice: FALLBACK_GAS_PRICE }, ["Yes"])
        expect(estimated.lines("Yes").map(([label]) => label)).toContain("Network fee (estimate: the price could not be read)")
        const req = weightedVoteRequest(ctx(), ["Yes"])
        vi.mocked(freshFeeForGasWanted).mockImplementationOnce(async (gasWanted) => feeForGasWanted(gasWanted, { gas: 1000, ugnot: 2 }))
        await expect(req.recheck!("Yes")).rejects.toThrow("The network fee increased since review.")
        vi.mocked(freshFeeForGasWanted).mockRejectedValueOnce(new Error("offline"))
        await expect(req.recheck!("Yes")).rejects.toThrow("Couldn't confirm the current network fee. Nothing was sent")
        await expect(req.recheck!("Yes")).resolves.toBeUndefined()
    })

    it("refuses a reply with no transaction hash as a success", async () => {
        vi.mocked(doContractBroadcast).mockResolvedValueOnce({ hash: "" })
        await expect(weightedVoteRequest(ctx(), ["Yes"]).send("Yes", async () => {})).rejects.toThrow("Wallet returned no valid transaction hash")
    })

    it("confirms a vote only when the chain shows the ballot cast", async () => {
        const req = weightedVoteRequest(ctx(), ["Yes", "No", "Abstain"])
        vi.mocked(readWeightedBallot).mockResolvedValueOnce(ballot({ choice: "no", votedAtHeight: "9" }))
        expect(await req.verify!("No", HASH, undefined)).toBe(true)
        vi.mocked(readWeightedBallot).mockResolvedValueOnce(ballot({ choice: "yes", votedAtHeight: "9" }))
        expect(await req.verify!("No", HASH, undefined)).toBe(false)
    })

    it("builds nothing for a DAO whose writes are held on this network", () => {
        const held = ctx("17", { config: { ...snapshot().config, realmPath: "gno.land/r/samcrew/memba_dao_v2" } })
        expect(() => weightedVoteRequest({ ...held, realmPath: "gno.land/r/samcrew/memba_dao_v2" }, ["Yes"])).toThrow("Mainnet governance writes remain on hold")
    })

    it("builds nothing for a version before the application version: no measured budget, no published ballot", () => {
        const v2 = weightedFixture(2)
        const snap = { config: weightedConfigSchema.parse(v2.config), members: v2.members, page: weightedPageSchema.parse(v2.page) } as WeightedSnapshot
        const p = snap.page.proposals[0] as WeightedProposal
        expect(() => weightedVoteRequest({ realmPath: v2.config.realmPath, daoName: "Team", snapshot: snap, proposal: { ...p, status: "VOTING", votingClosed: false }, caller: snap.members[1].address, gasPrice: PRICE }, ["Yes"]))
            .toThrow("This DAO version is acted on in its workspace")
        expect(() => weightedExecuteRequest({ realmPath: v2.config.realmPath, daoName: "Team", snapshot: snap, proposal: { ...p, status: "READY", ready: true }, caller: snap.members[1].address, gasPrice: PRICE }, [], true))
            .toThrow("This DAO version is acted on in its workspace")
    })
})

describe("the vote options offered to a voter", () => {
    const open = proposal("17")
    it("are none once voting is over", () => {
        expect(weightedVoteOptions({ ...open, votingClosed: true }, WEIGHTED_APPLICATIONS_SCHEMA, ballot())).toEqual([])
    })
    it("wait for the ballot on the application version, and leave out the choice already cast or any for an ineligible voter", () => {
        expect(weightedVoteOptions(open, WEIGHTED_APPLICATIONS_SCHEMA, undefined)).toBeNull()
        expect(weightedVoteOptions(open, WEIGHTED_APPLICATIONS_SCHEMA, ballot({ choice: "yes", votedAtHeight: "3" }))).toEqual(["No", "Abstain"])
        expect(weightedVoteOptions(open, WEIGHTED_APPLICATIONS_SCHEMA, ballot({ eligible: false }))).toEqual([])
        expect(weightedVoteOptions(open, WEIGHTED_APPLICATIONS_SCHEMA, "error")).toEqual([])
    })
    it("are none on a version that publishes no ballot", () => {
        expect(weightedVoteOptions(open, "memba-weighted-host/v2", undefined)).toEqual([])
    })
})

describe("a weighted execution as a signing request", () => {
    it("names what it invalidates, asks for one acknowledgement and signs exactly the execute call", () => {
        const req = weightedExecuteRequest(ctx(), ["26", "25"], false)
        expect(req.summary).toBe("Execute #17 “Market config · Set a fee”")
        expect(req.warns).toEqual(["Executing #17 invalidates 2 open proposals #26, #25 and any other open proposal. They cannot be revived; their proposers would need to propose again."])
        expect(req.acks).toEqual(["I understand that executing #17 invalidates every other open proposal of this DAO."])
        const budget = v12ExecuteBudget(proposal("17").action)
        expect(req.prepare(undefined).msgs).toEqual([{ type: "vm/MsgCall", value: { caller: MIKAEL, send: "", pkg_path: MEMBA_DAO, func: "Execute", args: ["17"], max_deposit: `${budget.maxDepositUgnot}ugnot` } }])
        expect(req.receipt).toEqual({ chainId: "gnoland-1", realmPath: MEMBA_DAO, caller: MIKAEL, operation: "weighted-execute:17" })
    })

    it("refuses to sign when the proposal would now run another action, or is no longer ready", async () => {
        const open = snapshot().page.proposals.filter((p) => "status" in p && ["VOTING", "TIMELOCKED", "READY"].includes(p.status) && p.id !== "17").map((p) => p.id)
        const req = weightedExecuteRequest(ctx(), open, false)
        await expect(req.recheck!(undefined)).resolves.toBeUndefined()
        const other = proposal("17")
        vi.mocked(readWeightedProposal).mockResolvedValueOnce({ ...other, action: { ...other.action, bps: "999" } } as Awaited<ReturnType<typeof readWeightedProposal>>)
        await expect(req.recheck!(undefined)).rejects.toThrow("Proposal changed during confirmation; refresh")
        vi.mocked(readWeightedProposal).mockResolvedValueOnce({ ...other, ready: false, status: "VOTING" } as Awaited<ReturnType<typeof readWeightedProposal>>)
        await expect(req.recheck!(undefined)).rejects.toThrow("Proposal changed during confirmation; refresh")
    })

    it("refuses to sign an execution when more proposals are open than were reviewed", async () => {
        const open = snapshot().page.proposals.filter((p) => "status" in p && ["VOTING", "TIMELOCKED", "READY"].includes(p.status) && p.id !== "17").map((p) => p.id)
        await expect(weightedExecuteRequest(ctx(), open, false).recheck!(undefined)).resolves.toBeUndefined()
        await expect(weightedExecuteRequest(ctx(), open.slice(1), false).recheck!(undefined)).rejects.toThrow("More proposals are open than when you reviewed this execution. Review it again.")
        // A list reviewed as complete may not become partial.
        await expect(weightedExecuteRequest(ctx(), open, true).recheck!(undefined)).rejects.toThrow("More proposals are open")
    })

    it("confirms an execution only when the chain shows the proposal executed", async () => {
        const req = weightedExecuteRequest(ctx(), [], true)
        vi.mocked(readWeightedProposal).mockResolvedValueOnce({ ...proposal("17"), status: "EXECUTED" } as Awaited<ReturnType<typeof readWeightedProposal>>)
        expect(await req.verify!(undefined, HASH, undefined)).toBe(true)
        expect(await req.verify!(undefined, HASH, undefined)).toBe(false)
    })
})
