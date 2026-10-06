import { describe, expect, it } from "vitest"
import native from "./testdata/memba-gov/native.json"
import { BRIDGE_PATH, GOV_PATH } from "./govActions"
import { approvalMatches, bridgeExecution, GOV_BUDGETS, planGovCall } from "./govTx"
import type { GovProposal } from "./membaGov"

const ME = "g1747t5m2f08plqjlrjk2q0qld7465hxz8gkx59c"
const proposals = [...native.page0.proposals, ...native.page22.proposals] as GovProposal[]
const find = (action: string, has = "") => proposals.find((p) => p.action === action && p.args.includes(has))!

describe("memba_gov transactions", () => {
    it("builds each call with its budget, and the deposit cap inside the signed message", () => {
        const vote = planGovCall(ME, { type: "vote", id: "7", vote: "abstain" })
        expect(vote.msg).toEqual({ type: "vm/MsgCall", value: { caller: ME, send: "", pkg_path: GOV_PATH, func: "Vote", args: ["7", "abstain"], max_deposit: "500000ugnot" } })
        expect(vote.gasWanted).toBe(GOV_BUDGETS.vote.gasWanted)
        expect(planGovCall(ME, { type: "join" }).msg.value).toMatchObject({ pkg_path: GOV_PATH, func: "Join", args: [] })
        expect(planGovCall(ME, { type: "execute", proposal: find("Uninvite") }).msg.value).toMatchObject({ pkg_path: GOV_PATH, func: "Execute", args: ["42"] })
        expect(planGovCall(ME, { type: "pause", app: "memba_feed_v1" }).msg.value).toMatchObject({ pkg_path: BRIDGE_PATH, func: "EmergencyPause", args: ["memba_feed_v1"] })
        expect(planGovCall(ME, { type: "expire-pause", app: "escrow_v4" }).msg.value).toMatchObject({ func: "ExpirePause", args: ["escrow_v4"] })
        expect(() => planGovCall(ME, { type: "pause", app: "memba_market_config" })).toThrow("no pause")
        expect(() => planGovCall(ME.toUpperCase(), { type: "join" })).toThrow()
    })

    it("executes an app proposal through the bridge entrypoint, with the voted values as its parameters", () => {
        const pay = find("escrow_v4.ResolveDispute", "|b:0|")
        expect(bridgeExecution(pay)).toEqual({ func: "ResolveDispute", args: [pay.id, "0", "0", "false"], approval: "s:14:ResolveDispute|s:1:0|i:0|b:0" })
        expect(planGovCall(ME, { type: "execute", proposal: pay }).msg.value).toMatchObject({ pkg_path: BRIDGE_PATH, func: "ResolveDispute", max_deposit: "2000000ugnot" })
        const signer = find("memba_quest_attestation_v1.SetSigner")
        expect(bridgeExecution(signer).func).toBe("SetQuestSigner")
        const channel = find("memba_dao_channels_v2.CreateChannel")
        expect(bridgeExecution(channel).args).toEqual([channel.id, "memba_dao_channels_v2", "news", "Team news", "text"])
        expect(bridgeExecution(find("escrow_v4.CancelFeeRecipient")).args).toHaveLength(1)
        // Every bridge proposal the fixtures file can be executed by Memba.
        for (const p of proposals.filter((p) => p.target === BRIDGE_PATH)) expect(() => bridgeExecution(p), p.action).not.toThrow()
        expect(() => bridgeExecution(find("x.Op"))).toThrow("its target realm consumes the approval itself")
    })

    it("runs an app proposal only while the bridge would consume exactly it", () => {
        const fee = find("memba_market_config.SetFee")
        expect(approvalMatches(fee, native.approval)).toBe(true)
        expect(approvalMatches(fee, { ...native.approval, args: "s:7:service|i:300|i:250|u:1" })).toBe(false) // the fee changed since the vote
        expect(approvalMatches(fee, { ...native.approval, scope: "x" })).toBe(false)
        expect(approvalMatches({ ...fee, class: 1 }, native.approval)).toBe(false)
    })
})

describe("the bridge entrypoint table", () => {
    it("calls each op exactly as the bridge's node fixtures do, entrypoint, order and values", async () => {
        const { calls } = (await import("./testdata/memba-gov/calls.json")).default as { calls: { action: string; args: string | null; call: string }[] }
        const as = (action: string, args: string) => ({ ...find("memba_market_config.SetFee"), action, args })
        const pinned = new Set<string>()
        for (const c of calls) {
            if (c.args !== null) {
                expect(bridgeExecution(as(c.action, c.args)).approval, `${c.action} ${c.args}`).toBe(c.call)
                pinned.add(c.action.split(".")[1])
            } else if (proposals.some((p) => p.action === c.action && bridgeExecution(p).approval === c.call)) {
                // Arguments read at run time: a testdata proposal of that action maps to exactly this fixture call.
                pinned.add(c.action.split(".")[1])
            }
        }
        expect(pinned.size).toBe(20) // every op of the bridge, by at least one exact call
        // The parameters a call carries are the voted values, as typed strings for the wallet.
        const pay = find("escrow_v4.ResolveDispute", "|b:0|")
        expect(bridgeExecution(pay).args).toEqual([pay.id, "0", "0", "false"])
    })
})
