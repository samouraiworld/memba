/**
 * escrowActions — the calls offered on a contract mirror escrow_v4's guards
 * (escrow.gno of gno.land/r/samcrew/escrow_v4 as published at gnoland-1 h299934): who may call, in which contract
 * and milestone state, and when the pause or the realm's pause-adjusted
 * deadlines hold a call back.
 */
import { describe, expect, it } from "vitest"
import { escrowActions, escrowContractPath, escrowRole, planEscrowAction, type EscrowAction } from "./escrowActions"
import type { EscrowContractView, EscrowMilestoneView, EscrowPauseState } from "./escrowState"

const CLIENT = "g1747t5m2f08plqjlrjk2q0qld7465hxz8gkx59c"
const FREELANCER = "g1u7y667z64x2h7vc6fmpcprgey4ck233jaww9zq"
const STRANGER = "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5"
const ESCROW = "gno.land/r/samcrew/escrow_v4"

const OPEN: EscrowPauseState = { paused: false, exitsOpen: true, exitsReopenAt: 0, pausedBlocks: 0 }
/** Inside the blocking window: exits shut until 1,183,273. */
const BLOCKING: EscrowPauseState = { paused: true, exitsOpen: false, exitsReopenAt: 1_183_273, pausedBlocks: 50_000 }
/** Still paused, but past the window: only new money is refused. */
const LAPSED: EscrowPauseState = { paused: true, exitsOpen: true, exitsReopenAt: 1_183_273, pausedBlocks: 183_273 }

const HEIGHT = 2_000_000

const ms = (index: number, status: EscrowMilestoneView["status"], over: Partial<EscrowMilestoneView> = {}): EscrowMilestoneView => ({
    index, title: `M${index}`, amountUgnot: 1_000 * (index + 1), status,
    fundedAt: null, completedAt: null, disputedAt: null, refundAt: null, resolveAt: null, ...over,
})

const contract = (status: EscrowContractView["status"], milestones: EscrowMilestoneView[], over: Partial<EscrowContractView> = {}): EscrowContractView => ({
    id: "7", title: "Logo", description: "", client: CLIENT, freelancer: FREELANCER, status, createdAt: 1_000,
    fundedAt: null, refundAt: null, expireAt: null, resolveAt: null, milestones,
    totals: { amountUgnot: 0, escrowedUgnot: 0, releasedUgnot: 0, refundedUgnot: 0 }, ...over,
})

const keys = (actions: EscrowAction[]) => actions.map((a) => (a.milestone === null ? a.kind : `${a.kind}:${a.milestone}`)).sort()

/** Deadlines in these fixtures are already past at HEIGHT. */
const SCENARIOS: { name: string; c: EscrowContractView; client: string[]; freelancer: string[]; stranger: string[] }[] = [
    {
        name: "active, never funded",
        c: contract("active", [ms(0, "pending")], { expireAt: 865_000 }),
        client: ["cancel", "expire", "fund:0"],
        freelancer: ["expire"],
        stranger: ["expire"],
    },
    {
        name: "active, a milestone funded",
        c: contract("active", [ms(0, "funded", { fundedAt: 1_100, refundAt: 865_100 })]),
        client: ["cancel", "claimRefund:0", "dispute:0"],
        freelancer: ["claimRefund:0", "complete:0", "dispute:0"],
        stranger: ["claimRefund:0"],
    },
    {
        name: "active, a milestone delivered",
        c: contract("active", [ms(0, "completed", { fundedAt: 1_100, completedAt: 1_200 })]),
        client: ["cancel", "dispute:0", "release:0"],
        freelancer: ["dispute:0"],
        stranger: [],
    },
    {
        name: "active, one released and one pending (no longer expirable)",
        c: contract("active", [ms(0, "released"), ms(1, "pending")]),
        client: ["cancel", "fund:1"],
        freelancer: [],
        stranger: [],
    },
    {
        name: "disputed: frozen but for disputes and the timeouts",
        c: contract("disputed", [
            ms(0, "disputed", { fundedAt: 1_100, disputedAt: 1_300, resolveAt: 807_700 }),
            ms(1, "funded", { fundedAt: 1_150, refundAt: 865_150 }),
            ms(2, "completed", { fundedAt: 1_160, completedAt: 1_170 }),
            ms(3, "pending"),
        ]),
        client: ["claimDisputeTimeout:0", "claimRefund:1", "dispute:1", "dispute:2"],
        freelancer: ["claimDisputeTimeout:0", "claimRefund:1", "dispute:1", "dispute:2"],
        stranger: ["claimDisputeTimeout:0", "claimRefund:1"],
    },
    {
        name: "completed",
        c: contract("completed", [ms(0, "released")]),
        client: ["archive"],
        freelancer: [],
        stranger: [],
    },
    {
        name: "cancelled with a never-funded milestone",
        c: contract("cancelled", [ms(0, "refunded"), ms(1, "pending")]),
        client: ["archive"],
        freelancer: [],
        stranger: [],
    },
]

describe("escrowActions — who sees which call, in which state", () => {
    for (const s of SCENARIOS) {
        it(s.name, () => {
            expect(keys(escrowActions(s.c, CLIENT, OPEN, HEIGHT))).toEqual(s.client)
            expect(keys(escrowActions(s.c, FREELANCER, OPEN, HEIGHT))).toEqual(s.freelancer)
            expect(keys(escrowActions(s.c, STRANGER, OPEN, HEIGHT))).toEqual(s.stranger)
            // Without a wallet only the permissionless calls are listed, and none is enabled.
            const none = escrowActions(s.c, "", OPEN, HEIGHT)
            expect(keys(none)).toEqual(s.stranger)
            expect(none.every((a) => !a.availability.available && /Connect a wallet/.test(a.availability.reason))).toBe(true)
        })
    }

    it("the connected address's role", () => {
        const c = contract("active", [ms(0, "pending")])
        expect([escrowRole(c, CLIENT), escrowRole(c, FREELANCER), escrowRole(c, STRANGER), escrowRole(c, "")]).toEqual(["client", "freelancer", "other", "other"])
    })
})

describe("escrowActions — pause", () => {
    // Every listed call, for every role, in every scenario.
    const all = SCENARIOS.flatMap((s) => [CLIENT, FREELANCER, STRANGER].flatMap((caller) =>
        (["open", "blocking", "lapsed"] as const).map((p) => ({ s, caller, p, actions: escrowActions(s.c, caller, { open: OPEN, blocking: BLOCKING, lapsed: LAPSED }[p], 1_000_000) }))))

    it("refuses funding whenever the realm is paused, exits or not (assertAcceptsNewMoney)", () => {
        const fund = all.flatMap(({ p, actions }) => actions.filter((a) => a.kind === "fund").map((a) => [p, a.availability.available]))
        expect(fund.length).toBeGreaterThan(0)
        for (const [p, available] of fund) expect(available).toBe(p === "open")
        const blocked = escrowActions(SCENARIOS[0].c, CLIENT, LAPSED, 1_000_000).find((a) => a.kind === "fund")!
        expect(blocked.availability).toEqual({ available: false, reason: "Escrow is paused: funding is refused until it is unpaused." })
    })

    it("holds every other call only inside the blocking window (assertOpen)", () => {
        const others = all.flatMap(({ p, actions }) => actions.filter((a) => a.kind !== "fund").map((a) => ({ p, a })))
        expect(others.length).toBeGreaterThan(20)
        for (const { p, a } of others) {
            expect(a.availability.available).toBe(p !== "blocking")
            if (p === "blocking" && !a.availability.available) {
                expect(a.availability.reason).toMatch(/reopens at block 1,183,273 \(about 7 days\), even if nobody unpauses it/)
            }
        }
    })
})

describe("escrowActions — deadlines are the realm's pause-adjusted heights", () => {
    // Funded at 1,000; 50,000 paused blocks moved the refund deadline from 865,000 to 915,000.
    const funded = contract("active", [ms(0, "funded", { fundedAt: 1_000, refundAt: 915_000 })])
    const refund = (height: number, caller = STRANGER, pause = OPEN) =>
        escrowActions(funded, caller, pause, height).find((a) => a.kind === "claimRefund")!.availability

    it("is not offered at the unadjusted deadline", () => {
        expect(refund(865_000)).toEqual({ available: false, reason: "Nobody marked it delivered. Anyone can refund it to the client from block 915,000 (about 46 hours)." })
        expect(refund(914_999).available).toBe(false)
    })

    it("is offered from the adjusted deadline on", () => {
        expect(refund(915_000)).toEqual({ available: true })
        expect(refund(1_000_000)).toEqual({ available: true })
    })

    it("fails closed without a block height", () => {
        expect(refund(0)).toEqual({ available: false, reason: "Could not read the current block height." })
    })

    it("past the deadline, still waits for the blocking window and a wallet", () => {
        expect(refund(1_000_000, STRANGER, BLOCKING).available).toBe(false)
        expect(refund(1_000_000, "")).toEqual({ available: false, reason: "Connect a wallet to sign this." })
    })

    it("dispute timeout and unfunded expiry follow resolveAt and expireAt the same way", () => {
        const disputed = contract("disputed", [ms(0, "disputed", { fundedAt: 1_000, disputedAt: 2_000, resolveAt: 808_400 })])
        const settle = (h: number) => escrowActions(disputed, STRANGER, OPEN, h).find((a) => a.kind === "claimDisputeTimeout")!.availability
        expect(settle(808_399).available).toBe(false)
        expect(settle(808_400).available).toBe(true)
        const unfunded = contract("active", [ms(0, "pending")], { expireAt: 900_000 })
        const expire = (h: number) => escrowActions(unfunded, STRANGER, OPEN, h).find((a) => a.kind === "expire")!.availability
        expect(expire(899_999)).toEqual({ available: false, reason: "Never funded. Anyone can expire it from block 900,000 (about 1 minute)." })
        expect(expire(900_000).available).toBe(true)
    })

    it("a party's own calls do not wait for a deadline", () => {
        const acts = escrowActions(funded, FREELANCER, OPEN, 2_000)
        expect(acts.find((a) => a.kind === "complete")!.availability.available).toBe(true)
        expect(acts.find((a) => a.kind === "claimRefund")!.availability.available).toBe(false)
    })
})

describe("planEscrowAction — the signed message", () => {
    const find = (c: EscrowContractView, caller: string, kind: EscrowAction["kind"], m: number | null = null) =>
        escrowActions(c, caller, OPEN, HEIGHT).find((a) => a.kind === kind && a.milestone === m)!

    it("FundMilestone sends exactly the stored milestone amount", () => {
        const c = contract("active", [ms(0, "released"), ms(1, "pending", { amountUgnot: 123_456_789 })])
        const a = find(c, CLIENT, "fund", 1)
        expect(a.sendUgnot).toBe(123_456_789)
        const p = planEscrowAction(a, c, CLIENT, ESCROW)
        expect(p.sendUgnot).toBe(123_456_789)
        expect(p.msg.value).toMatchObject({ caller: CLIENT, pkg_path: ESCROW, func: "FundMilestone", args: ["7", "1"], send: "123456789ugnot" })
    })

    it("refuses to fund an amount other than the one read", () => {
        const c = contract("active", [ms(0, "pending", { amountUgnot: 5_000 })])
        const a = { ...find(c, CLIENT, "fund", 0), sendUgnot: 6_000 }
        expect(() => planEscrowAction(a, c, CLIENT, ESCROW)).toThrow(/amount changed/)
    })

    it.each([
        ["complete", FREELANCER, contract("active", [ms(0, "funded")]), 0, "CompleteMilestone", ["7", "0"]],
        ["release", CLIENT, contract("active", [ms(0, "completed")]), 0, "ReleaseFunds", ["7", "0"]],
        ["dispute", FREELANCER, contract("active", [ms(0, "released"), ms(1, "completed")]), 1, "RaiseDispute", ["7", "1"]],
        ["cancel", CLIENT, contract("active", [ms(0, "pending")]), null, "CancelContract", ["7"]],
        ["archive", CLIENT, contract("completed", [ms(0, "released")]), null, "ArchiveContract", ["7"]],
        ["claimRefund", STRANGER, contract("active", [ms(0, "funded", { refundAt: 10 })]), 0, "ClaimRefund", ["7", "0"]],
        ["claimDisputeTimeout", STRANGER, contract("disputed", [ms(0, "disputed", { resolveAt: 10 })]), 0, "ClaimDisputeTimeout", ["7", "0"]],
        ["expire", STRANGER, contract("active", [ms(0, "pending")], { expireAt: 10 }), null, "ExpireUnfunded", ["7"]],
    ] as const)("%s signs %s", (kind, caller, c, m, func, args) => {
        const p = planEscrowAction(find(c, caller, kind, m), c, caller, ESCROW)
        expect(p.msg.value).toMatchObject({ caller, pkg_path: ESCROW, func, args: [...args], send: "" })
        expect(p.sendUgnot).toBe(0)
        expect(p.msg.value.max_deposit).toBe(`${p.maxDepositUgnot}ugnot`)
    })

    it("the shareable page path", () => {
        expect(escrowContractPath("42")).toBe("marketplace/services/contract/42")
    })
})
