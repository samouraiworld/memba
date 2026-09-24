/**
 * builders.test.ts — the escrow MsgCall builders, pinned to the deployed realm.
 *
 * The API table below is copied from the source of `gno.land/r/samcrew/escrow_v3`
 * as published on gno.land mainnet (`gnoland-1`, AddPackage at height 265888 by the
 * samcrew namespace multisig), read back with `vm/qfile`. escrow.gno SHA-256:
 * d3a7c2a5480af64e28ce990c8fc99e7c8bad850803a5af092a3ace65bfdba57f. The realm is
 * immutable: if a builder test here fails, the builder is wrong, not the table.
 *
 * The messages also go through doContractBroadcast → toAdenaMessages, which only
 * accepts the Amino type "vm/MsgCall" (an earlier "/vm.m_call" made every escrow
 * action fail before the wallet).
 */

import { describe, it, expect } from "vitest"
import {
    buildCreateContractMsg,
    buildFundMilestoneMsg,
    buildCompleteMilestoneMsg,
    buildReleaseFundsMsg,
    buildRaiseDisputeMsg,
    buildCancelContractMsg,
    buildClaimRefundMsg,
    buildClaimDisputeTimeoutMsg,
    encodeMilestones,
    parseMilestonesArg,
    parseUgnotAmount,
    EscrowInputError,
} from "./builders"
import { toAdenaMessages } from "../grc20"

const CLIENT = "g1747t5m2f08plqjlrjk2q0qld7465hxz8gkx59c"
const FREELANCER = "g1u7y667z64x2h7vc6fmpcprgey4ck233jaww9zq"
const ESCROW = "gno.land/r/samcrew/escrow_v3"
const MS = [{ title: "Design", amountUgnot: 5_000_000 }, { title: "Build", amountUgnot: 15_000_000 }]

/**
 * Every user-callable escrow_v3 entrypoint (the `cur realm` parameter is implicit)
 * and who may call it. Admin-only functions (Pause, Unpause, ResolveDispute,
 * TransferOwnership, AcceptOwnership, CancelOwnershipTransfer) have no builder:
 * Memba never signs them for a user.
 */
const REALM_API = {
    CreateContract: { params: ["freelancer address", "title string", "description string", "milestones string"], payable: false, caller: "anyone but the freelancer (becomes the client)" },
    FundMilestone: { params: ["contractId string", "milestoneIdx int"], payable: true, caller: "client, direct user call, exact milestone amount" },
    CompleteMilestone: { params: ["contractId string", "milestoneIdx int"], payable: false, caller: "freelancer" },
    ReleaseFunds: { params: ["contractId string", "milestoneIdx int"], payable: false, caller: "client or admin" },
    RaiseDispute: { params: ["contractId string", "milestoneIdx int"], payable: false, caller: "client or freelancer" },
    CancelContract: { params: ["contractId string"], payable: false, caller: "client" },
    ClaimRefund: { params: ["contractId string", "milestoneIdx int"], payable: false, caller: "anyone, after 864000 blocks" },
    ClaimDisputeTimeout: { params: ["contractId string", "milestoneIdx int"], payable: false, caller: "anyone, after 806400 blocks" },
} as const

const all = () => [
    buildCreateContractMsg(CLIENT, ESCROW, FREELANCER, "Logo", "A logo", MS),
    buildFundMilestoneMsg(CLIENT, ESCROW, "0", 1, 15_000_000),
    buildCompleteMilestoneMsg(FREELANCER, ESCROW, "0", 1),
    buildReleaseFundsMsg(CLIENT, ESCROW, "0", 1),
    buildRaiseDisputeMsg(CLIENT, ESCROW, "0", 1),
    buildCancelContractMsg(CLIENT, ESCROW, "0"),
    buildClaimRefundMsg(FREELANCER, ESCROW, "0", 1),
    buildClaimDisputeTimeoutMsg(FREELANCER, ESCROW, "0", 1),
]

describe("escrow builders — realm API", () => {
    it("covers every user-callable realm function, by exact name", () => {
        expect(all().map((m) => m.value.func).sort()).toEqual(Object.keys(REALM_API).sort())
    })

    it("passes arguments in the realm's order, one per parameter", () => {
        const [create, fund, complete, release, dispute, cancel, refund, timeout] = all()
        expect(create.value.args).toEqual([FREELANCER, "Logo", "A logo", "Design:5000000,Build:15000000"])
        for (const m of [fund, complete, release, dispute, refund, timeout]) expect(m.value.args).toEqual(["0", "1"])
        expect(cancel.value.args).toEqual(["0"])
        for (const m of all()) expect(m.value.args).toHaveLength(REALM_API[m.value.func].params.length)
    })

    it("sends coins only with FundMilestone, and exactly the milestone amount in ugnot", () => {
        for (const m of all()) {
            if (REALM_API[m.value.func].payable) expect(m.value.send).toBe("15000000ugnot")
            else expect(m.value.send).toBe("")
        }
    })

    it("targets the given realm and signs as the given caller", () => {
        for (const m of all()) {
            expect(m.type).toBe("vm/MsgCall")
            expect(m.value.pkg_path).toBe(ESCROW)
        }
        expect(all()[2].value.caller).toBe(FREELANCER)
        expect(all()[0].value.caller).toBe(CLIENT)
    })

    it("every message carries a storage-deposit cap in canonical ugnot", () => {
        for (const m of all()) expect(m.value.max_deposit).toMatch(/^[1-9]\d{0,14}ugnot$/)
    })

    it("every builder survives toAdenaMessages with its deposit cap", () => {
        const wire = toAdenaMessages(all())
        expect(wire.every((m) => m.type === "/vm.m_call")).toBe(true)
        wire.forEach((m, i) => expect((m.value as Record<string, unknown>).max_deposit).toBe(all()[i].value.max_deposit))
    })
})

describe("escrow builders — input checks mirror the realm", () => {
    const create = (over: Partial<{ caller: string; freelancer: string; title: string; description: string; milestones: { title: string; amountUgnot: number }[] }> = {}) =>
        buildCreateContractMsg(over.caller ?? CLIENT, ESCROW, over.freelancer ?? FREELANCER, over.title ?? "Logo", over.description ?? "", over.milestones ?? MS)

    it("rejects malformed or mistyped addresses and self-hire", () => {
        expect(() => create({ freelancer: "g1freelancer" })).toThrow(EscrowInputError)
        expect(() => create({ freelancer: FREELANCER.slice(0, -1) + "p" })).toThrow(EscrowInputError)
        expect(() => create({ caller: "g1testcaller" })).toThrow(EscrowInputError)
        expect(() => create({ freelancer: CLIENT })).toThrow(/yourself/)
    })

    it("counts title and description length in UTF-8 bytes, like the realm", () => {
        expect(() => create({ title: "" })).toThrow(EscrowInputError)
        expect(() => create({ title: "x".repeat(200) })).not.toThrow()
        expect(() => create({ title: "x".repeat(201) })).toThrow(EscrowInputError)
        expect(() => create({ title: "\u{1F680}".repeat(50) })).not.toThrow()
        expect(() => create({ title: "\u{1F680}".repeat(50) + "x" })).toThrow(EscrowInputError)
        expect(() => create({ description: "d".repeat(5000) })).not.toThrow()
        expect(() => create({ description: "é".repeat(2501) })).toThrow(EscrowInputError)
    })

    it("allows 1 to 20 milestones", () => {
        const ms = (n: number) => Array.from({ length: n }, (_, i) => ({ title: `M${i}`, amountUgnot: 1000 }))
        expect(() => create({ milestones: [] })).toThrow(EscrowInputError)
        expect(() => create({ milestones: ms(20) })).not.toThrow()
        expect(() => create({ milestones: ms(21) })).toThrow(EscrowInputError)
    })

    it("rejects milestone titles the realm would split, trim or refuse", () => {
        for (const title of ["", "a,b", "a:b", " a", "a ", "a\n", "\u0085a", "x".repeat(201)]) {
            expect(() => create({ milestones: [{ title, amountUgnot: 1000 }] }), JSON.stringify(title)).toThrow(EscrowInputError)
        }
        expect(() => create({ milestones: [{ title: "x".repeat(200), amountUgnot: 1000 }] })).not.toThrow()
    })

    it("requires whole ugnot amounts from the realm minimum to 15 digits", () => {
        for (const bad of [999, 0, -1000, 1000.5, Number.NaN, Infinity, 1e15]) {
            expect(() => create({ milestones: [{ title: "a", amountUgnot: bad }] }), String(bad)).toThrow(EscrowInputError)
            expect(() => buildFundMilestoneMsg(CLIENT, ESCROW, "0", 0, bad), String(bad)).toThrow(EscrowInputError)
        }
        expect(buildFundMilestoneMsg(CLIENT, ESCROW, "0", 0, 1000).value.send).toBe("1000ugnot")
        expect(buildFundMilestoneMsg(CLIENT, ESCROW, "0", 0, 999_999_999_999_999).value.send).toBe("999999999999999ugnot")
    })

    it("accepts only canonical contract ids and milestone indexes 0-19", () => {
        for (const id of ["", "01", "-1", "1.0", " 1", "1e3", "abc", "1234567890"]) {
            expect(() => buildCancelContractMsg(CLIENT, ESCROW, id), JSON.stringify(id)).toThrow(EscrowInputError)
        }
        for (const idx of [-1, 20, 1.5, Number.NaN]) {
            expect(() => buildReleaseFundsMsg(CLIENT, ESCROW, "3", idx), String(idx)).toThrow(EscrowInputError)
        }
        expect(buildReleaseFundsMsg(CLIENT, ESCROW, "499", 19).value.args).toEqual(["499", "19"])
    })

    it("refuses a realm path outside gno.land/r/", () => {
        expect(() => buildCancelContractMsg(CLIENT, "gno.land/p/samcrew/escrow_v3", "0")).toThrow(EscrowInputError)
        expect(() => buildCancelContractMsg(CLIENT, "", "0")).toThrow(EscrowInputError)
    })
})

describe("milestone and amount parsing is strict", () => {
    it("parseUgnotAmount accepts only canonical whole numbers", () => {
        expect(parseUgnotAmount(1000)).toBe(1000)
        expect(parseUgnotAmount("250000000")).toBe(250_000_000)
        for (const bad of ["", "01000", "+1000", "1000 ", " 1000", "1e3", "1000.0", "1_000", "0x3e8", "1000000000000000", 1.5, -1, "-1"]) {
            expect(() => parseUgnotAmount(bad), JSON.stringify(bad)).toThrow(EscrowInputError)
        }
    })

    it("parseMilestonesArg reads the realm's title:amount list and rejects anything it would reinterpret", () => {
        expect(parseMilestonesArg("Deposit:250000000,Final:250000000")).toEqual([
            { title: "Deposit", amountUgnot: 250_000_000 },
            { title: "Final", amountUgnot: 250_000_000 },
        ])
        for (const bad of ["", "A", "A:1000,", ",A:1000", "A:1000,,B:1000", "A: 1000", "A :1000", "A:1000.5", "A:1e3", ":1000", "A:999", "A:b:1000"]) {
            expect(() => parseMilestonesArg(bad), JSON.stringify(bad)).toThrow(EscrowInputError)
        }
    })

    it("encodeMilestones round-trips with parseMilestonesArg", () => {
        const s = "Sketches:5000000,Final files:15000000,Revisions:5000000"
        expect(encodeMilestones(parseMilestonesArg(s))).toBe(s)
    })
})
