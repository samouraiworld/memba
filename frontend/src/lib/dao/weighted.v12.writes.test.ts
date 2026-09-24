import { describe, expect, it } from "vitest"
import native from "./testdata/weighted-v12/native.json"
import exportsText from "./testdata/weighted-v12/realm-exports.txt?raw"
import policySource from "./testdata/weighted-v12/host/policy.gno.txt?raw"
import { assertWeightedPlanSignable, planWeightedTx, weightedProposalSchema, weightedVoteChoices, weightedWriteKinds, WEIGHTED_APPLICATIONS_SCHEMA, WEIGHTED_RECOVERY_SCHEMA, WEIGHTED_SCHEMA, type WeightedAction, type WeightedBallot, type WeightedProposal } from "./weighted"
import { ACCEPT_FUNCS, APPLICATION_POLICY_KEYS } from "./weightedApplications"
import { V12_EXECUTE_FALLBACK, v12CallBudget, v12ExecuteBudget } from "./weightedBudget"
import { toAdenaMessages } from "../grc20"

const realmPath = "gno.land/r/samcrew/memba_dao"
const schema = WEIGHTED_APPLICATIONS_SCHEMA
const records = native.records as unknown as Record<string, unknown>
const caller = (native.records.members.members as { address: string }[])[1].address
const proposal = (key: string) => weightedProposalSchema.parse(records[key]).proposal as WeightedProposal
const exported = new Map(exportsText.split("\n").filter(l => l && !l.startsWith("#")).map(l => { const m = l.match(/^\S+ (\w+)\(([^)]*)\)\s*(\w*)$/)!; return [m[1], m[2].split(", ").slice(1)] }))

/** Encode a builder argument the way gno converts a string argument to the declared parameter type. */
function acceptsAs(type: string, arg: string): boolean {
    if (type === "uint64") return /^(0|[1-9][0-9]{0,19})$/.test(arg) && BigInt(arg) <= 18446744073709551615n
    if (type === "string") return true
    return false
}

describe("v12 message builders match the realm's exported signatures", () => {
    it("builds each adapter acceptance as its own argument-free call, with its measured budget", () => {
        for (const adapter of APPLICATION_POLICY_KEYS) {
            const plan = planWeightedTx(caller, realmPath, { type: "accept", adapter }, schema, "test-chain")
            expect(plan.msg).toEqual({ type: "vm/MsgCall", value: { caller, send: "", pkg_path: realmPath, func: ACCEPT_FUNCS[adapter], args: [], max_deposit: `${v12CallBudget(ACCEPT_FUNCS[adapter]).maxDepositUgnot}ugnot` } })
            expect(exported.get(ACCEPT_FUNCS[adapter])).toEqual([])
            expect(plan).toMatchObject(v12CallBudget(ACCEPT_FUNCS[adapter]))
        }
        expect(() => planWeightedTx(caller, realmPath, { type: "accept", adapter: "homePolicy" as never }, schema, "test-chain")).toThrow("Unknown application adapter")
        expect(() => planWeightedTx(caller, realmPath, { type: "accept", adapter: "constructor" as never }, schema, "test-chain")).toThrow("Unknown application adapter")
    })

    it("builds Vote(id uint64, vote string) with the policy's three ballot values only", () => {
        const [idType, voteType] = exported.get("Vote")!.map(p => p.split(" ")[1])
        expect([idType, voteType]).toEqual(["uint64", "string"])
        const policyVotes = [...policySource.matchAll(/^\t(?:Yes|No|Abstain)\s+Vote = "(\w+)"$/gm)].map(m => m[1])
        expect(policyVotes).toEqual(["yes", "no", "abstain"])
        for (const vote of policyVotes) {
            const plan = planWeightedTx(caller, realmPath, { type: "vote", id: "17", vote } as WeightedAction, schema, "test-chain")
            expect(plan.msg.value).toMatchObject({ func: "Vote", args: ["17", vote], max_deposit: "40000ugnot" })
            expect(acceptsAs(idType, plan.msg.value.args[0] as string) && acceptsAs(voteType, plan.msg.value.args[1] as string)).toBe(true)
            expect(plan.gasWanted).toBe(24_800_000)
        }
        for (const vote of ["YES", "veto", ""]) expect(() => planWeightedTx(caller, realmPath, { type: "vote", id: "17", vote } as never, schema, "test-chain")).toThrow()
        for (const id of ["0", "01", "-1", "18446744073709551616", '1); Execute(2']) expect(() => planWeightedTx(caller, realmPath, { type: "vote", id, vote: "yes" }, schema, "test-chain")).toThrow()
    })

    it("builds Execute(id uint64) sized by the stored action it runs", () => {
        expect(exported.get("Execute")).toEqual(["id uint64"])
        const fee = proposal("proposal_17"), accept = proposal("proposal_13")
        expect(planWeightedTx(caller, realmPath, { type: "execute", id: "17" }, schema, "test-chain", fee.action)).toMatchObject({ msg: { value: { func: "Execute", args: ["17"], max_deposit: "190000ugnot" } }, gasWanted: 41_000_000 })
        expect(planWeightedTx(caller, realmPath, { type: "execute", id: "13" }, schema, "test-chain", accept.action)).toMatchObject({ ...v12ExecuteBudget({ type: "feedback", operation: "accept-owner" }), msg: { value: { max_deposit: "500000ugnot" } } })
        expect(planWeightedTx(caller, realmPath, { type: "execute", id: "3" }, schema, "test-chain", { type: "recover-member" })).toMatchObject(V12_EXECUTE_FALLBACK)
        expect(() => planWeightedTx(caller, realmPath, { type: "execute", id: "17" }, schema, "test-chain")).toThrow("needs the proposal's action")
    })

    it("sends no funds and hands the deposit cap to the wallet in the signed message", () => {
        const plan = planWeightedTx(caller, realmPath, { type: "accept", adapter: "escrowPolicy" }, schema, "test-chain")
        expect(plan.msg.value.send).toBe("")
        expect(toAdenaMessages([plan.msg])[0]).toMatchObject({ type: "/vm.m_call", value: { func: "ProposeEscrowAccept", args: [], max_deposit: "4340000ugnot" } })
    })

    it("builds nothing at all on gnoland-1, for any contract version", () => {
        for (const version of [WEIGHTED_SCHEMA, WEIGHTED_RECOVERY_SCHEMA, WEIGHTED_APPLICATIONS_SCHEMA]) {
            expect(weightedWriteKinds(version, "gnoland-1").size).toBe(0)
            for (const action of [{ type: "vote", id: "1", vote: "yes" }, { type: "execute", id: "1" }, { type: "accept", adapter: "marketPolicy" }] as const)
                expect(() => planWeightedTx(caller, realmPath, action, version, "gnoland-1", { type: "set-role", grant: true })).toThrow("Mainnet governance writes remain on hold")
        }
        expect([...weightedWriteKinds(schema, "test-chain")].sort()).toEqual(["accept", "execute", "vote"])
        expect(weightedWriteKinds("memba-weighted-host/v13", "test-chain").size).toBe(0)
        expect(() => planWeightedTx(caller, realmPath, { type: "accept", adapter: "marketPolicy" }, WEIGHTED_RECOVERY_SCHEMA, "test-chain")).toThrow("read-only")
    })

    it("re-checks the reviewed cap before signing", () => {
        const plan = planWeightedTx(caller, realmPath, { type: "accept", adapter: "marketPolicy" }, schema, "test-chain")
        expect(() => assertWeightedPlanSignable(plan)).not.toThrow()
        const tamper = (max_deposit: unknown, extra: object = {}) => () => assertWeightedPlanSignable({ ...plan, ...extra, msg: { ...plan.msg, value: { ...plan.msg.value, max_deposit } } })
        for (const cap of ["2130001ugnot", "2130000 ugnot", "2.13GNOT", "2130000ugnot,1ugnot", "", undefined, 2130000]) expect(tamper(cap), String(cap)).toThrow()
        expect(tamper("10000001ugnot", { maxDepositUgnot: 10_000_001 })).toThrow("ceiling")
        expect(tamper("2130000ugnot", { gasWanted: 0 })).toThrow("gas")
        // A legacy (v1/v2) plan carries no cap and must not gain one.
        const legacy = planWeightedTx(caller, realmPath, { type: "vote", id: "1", vote: "yes" }, WEIGHTED_SCHEMA, "test-chain")
        expect(legacy).toEqual({ msg: { type: "vm/MsgCall", value: { caller, send: "", pkg_path: realmPath, func: "Vote", args: ["1", "yes"] } } })
        expect(() => assertWeightedPlanSignable(legacy)).not.toThrow()
        expect(() => assertWeightedPlanSignable({ ...legacy, msg: { ...legacy.msg, value: { ...legacy.msg.value, max_deposit: "1ugnot" } } })).toThrow()
    })
})

describe("ballot-aware votes (v12)", () => {
    const open = { status: "VOTING", votingClosed: false } as const
    const ballot = (choice: WeightedBallot["choice"], eligible = true): WeightedBallot => ({ schema, proposalId: "17", voter: caller, eligible, choice, votedAtHeight: choice ? "9" : null })
    it("offers every choice before voting, and never the same choice twice", () => {
        expect([...weightedVoteChoices(open, ballot(null))]).toEqual(["yes", "no", "abstain"])
        expect([...weightedVoteChoices(open, ballot("yes"))]).toEqual(["no", "abstain"])
        expect([...weightedVoteChoices(open, ballot("abstain"))]).toEqual(["yes", "no"])
    })
    it("still allows a change after qualification, until voting closes", () => {
        for (const status of ["TIMELOCKED", "READY"]) expect([...weightedVoteChoices({ status, votingClosed: false }, ballot("no"))]).toEqual(["yes", "abstain"])
        for (const p of [{ status: "READY", votingClosed: true }, { status: "EXPIRED", votingClosed: true }, { status: "EXECUTED", votingClosed: false }, { status: "INVALIDATED", votingClosed: false }])
            expect(weightedVoteChoices(p, ballot(null)).size).toBe(0)
    })
    it("offers nothing to an ineligible voter or before the ballot is read", () => {
        expect(weightedVoteChoices(open, ballot(null, false)).size).toBe(0)
        expect(weightedVoteChoices(open, undefined).size).toBe(0)
        expect(weightedVoteChoices(open, "error").size).toBe(0)
    })
})
