import { beforeEach, describe, expect, it, vi } from "vitest"
import type { MembaV2Proposal } from "../../lib/dao/membaV2"

const NOW = Math.floor(Date.now() / 1000)
const proposalOf = (over: Partial<MembaV2Proposal> = {}) => ({
    id: 7, title: "Adopt the charter", description: "", category: "governance", author: "g1author",
    action: { kind: "text", target: "", power: 0, roles: [] }, electorate_power: 3, electorate_version: 3,
    created_at: NOW - 7200, voting_ends_at: NOW - 3600, status: "ACCEPTED", yes: 3, no: 0, abstain: 0,
    accepted_at: NOW - 3600, executable_at: NOW - 600, execute_by: NOW + 86400, ...over,
}) as MembaV2Proposal

const chain = vi.hoisted(() => ({
    config: null as { v2: { archived: boolean; electorate_version: number } } | null,
    members: [] as { address: string; votingPower: number }[],
    tx: false as boolean | "failed",
    proposal: null as unknown,
}))

vi.mock("../../lib/dao", async (orig) => ({
    ...(await orig<typeof import("../../lib/dao")>()),
    getDAOConfig: vi.fn(async () => chain.config),
    getDAOMembers: vi.fn(async () => chain.members),
}))
vi.mock("../../lib/dao/membaV2", async (orig) => ({
    ...(await orig<typeof import("../../lib/dao/membaV2")>()),
    readV2Proposal: vi.fn(async () => chain.proposal),
}))
// A fresh quote at the reviewed price (1 ugnot per 1,000 gas, with 20% headroom) unless a test raises it.
const quote = vi.hoisted(() => ({ ugnotPerThousandGas: 1 }))
vi.mock("../../lib/grc20", async (orig) => ({
    ...(await orig<typeof import("../../lib/grc20")>()),
    freshFeeForGasWanted: vi.fn(async (gasWanted: number) => Math.ceil((gasWanted * 1.2 * quote.ugnotPerThousandGas) / 1000)),
    networkGasPriceFresh: vi.fn(async () => ({ gas: 1000, ugnot: quote.ugnotPerThousandGas })),
}))
vi.mock("../wallet/sendRequest", async (orig) => ({
    ...(await orig<typeof import("../wallet/sendRequest")>()),
    verifySendTx: vi.fn(async () => chain.tx),
}))
vi.mock("../../lib/dao/daoTx", async (orig) => ({
    ...(await orig<typeof import("../../lib/dao/daoTx")>()),
    broadcastDaoTx: vi.fn(async () => ({ hash: "HASH" })),
}))

import { GNO_CHAIN_ID } from "../../lib/config"
import { FALLBACK_GAS_PRICE } from "../../lib/grc20"
import { broadcastDaoTx } from "../../lib/dao/daoTx"
import { formatChainTime } from "../../lib/dao/v2Lifecycle"
import { verifySendTx } from "../wallet/sendRequest"
import { actionProblem, executeRequest, executeScope, executeWindow, type ExecuteContext } from "./executeRequest"

const MEMBER = "g1member"
const REALM = "gno.land/r/alice/team"
const ctx = (over: Partial<ExecuteContext> = {}): ExecuteContext => ({
    realmPath: REALM, daoName: "Team", proposal: proposalOf(), caller: MEMBER, electorateVersion: 3,
    gasPrice: { gas: 1000, ugnot: 1 }, refresh: vi.fn(), ...over,
})
const nowSeconds = () => Math.floor(Date.now() / 1000)
const action = (kind: MembaV2Proposal["action"]["kind"], over: Partial<MembaV2Proposal["action"]> = {}) =>
    proposalOf({ action: { kind, target: kind === "text" || kind === "archive" ? "" : "g1target", power: kind === "add_member" ? 5 : 0, roles: [], ...over } })

beforeEach(() => {
    chain.config = { v2: { archived: false, electorate_version: 3 } }
    chain.members = [{ address: MEMBER, votingPower: 2 }]
    chain.proposal = proposalOf()
    chain.tx = false
    quote.ugnotPerThousandGas = 1
    localStorage.clear()
    vi.mocked(broadcastDaoTx).mockClear()
})

describe("executeRequest · the review", () => {
    it("says what a text proposal does, who may execute until when, the deposit cap, the fee and the network", () => {
        const req = executeRequest(ctx())
        const lines = new Map(req.lines(undefined))
        expect(req.title).toBe("Execute")
        expect(req.summary).toBe("Execute #7 “Adopt the charter”")
        expect(req.sub).toBe("Team")
        expect(lines.get("Action")).toBe("Text proposal")
        expect(lines.get("Effect")).toBe("None on chain; the decision is recorded.")
        expect(lines.get("Who may execute")).toBe(`Any member, until ${formatChainTime(NOW + 86400)}`)
        expect(lines.get("Storage deposit")).toMatch(/^up to [\d.]+ GNOT$/)
        expect(lines.has("Network")).toBe(true)
        expect(lines.has("Member")).toBe(false)
        expect(req.warns).toEqual([])
        expect(req.label(undefined)).toBe("Execute #7")
    })

    it("names the member, power and roles a membership change applies, and warns that open proposals are invalidated", () => {
        const req = executeRequest(ctx({ proposal: action("add_member", { roles: ["lead", "ops"] }) }))
        const lines = new Map(req.lines(undefined))
        expect(lines.get("Action")).toBe("Add member")
        expect(lines.get("Member")).toBe("g1target")
        expect(lines.get("Voting power")).toBe("5")
        expect(lines.get("Roles")).toBe("lead, ops")
        expect(req.warns).toEqual(["Changing membership closes every proposal still open for voting: they become invalidated."])
    })

    it("says a removal refunds the freed deposit to the executor", () => {
        const req = executeRequest(ctx({ proposal: action("remove_member") }))
        expect(new Map(req.lines(undefined)).get("Action")).toBe("Remove member")
        expect(req.warns).toHaveLength(2)
        expect(req.warns![1]).toMatch(/refunded to you, as the account that executes the removal/)
    })

    it("shows a roles change without a membership warning, and an archive as permanent", () => {
        const roles = executeRequest(ctx({ proposal: action("set_roles") }))
        expect(new Map(roles.lines(undefined)).get("Roles")).toBe("No roles")
        expect(roles.warns).toEqual([])
        const archive = executeRequest(ctx({ proposal: action("archive") }))
        expect(new Map(archive.lines(undefined)).get("Effect")).toBe("Permanent: no more proposals, votes or executions.")
        expect(archive.warns).toEqual(["Archiving is permanent."])
    })

    it("says when the price could not be read", () => {
        const lines = new Map(executeRequest(ctx({ gasPrice: FALLBACK_GAS_PRICE })).lines(undefined))
        expect([...lines.keys()]).toContain("Network fee (price not read; re-checked before signing)")
    })
})

describe("executeRequest · the message, receipt and proof", () => {
    it("builds the version-2 Execute call with the proposal id, under the classic page's receipt scope", () => {
        const req = executeRequest(ctx())
        const [msg] = req.prepare(undefined).msgs
        expect(msg.value).toMatchObject({ func: "Execute", pkg_path: REALM, caller: MEMBER, args: ["7"] })
        expect(String(msg.value.max_deposit)).toMatch(/^\d+ugnot$/)
        // The classic page's key: chain, realm, caller and "execute:<id>".
        expect(req.receipt).toEqual({ chainId: GNO_CHAIN_ID, realmPath: REALM, caller: MEMBER, operation: "execute:7" })
        expect(executeScope(REALM, MEMBER, 7)).toEqual(req.receipt)
    })

    it("sends exactly the fee shown, with the gas limit it pays for", async () => {
        const req = executeRequest(ctx())
        const beforeSign = async () => {}
        await req.send(undefined, beforeSign)
        // 25,000,000 gas at 1 ugnot per 1,000, with 20% headroom.
        expect(new Map(req.lines(undefined)).get("Network fee")).toBe("0.03 GNOT")
        expect(broadcastDaoTx).toHaveBeenCalledWith(expect.objectContaining({ gasWanted: 25_000_000 }), "Execute proposal #7", beforeSign,
            { fee: { gasWanted: 25_000_000, gasFee: 30_000 } })
    })

    it("confirms only when this transaction ran and the proposal reads as executed", async () => {
        const req = executeRequest(ctx())
        chain.proposal = proposalOf({ status: "EXECUTED" })
        chain.tx = true
        await expect(req.verify!(undefined, "HASH", undefined)).resolves.toBe(true)
        expect(verifySendTx).toHaveBeenCalledWith("HASH")
    })

    it("reads a refused transaction as refused, saying when another member executed it first", async () => {
        const req = executeRequest(ctx())
        chain.tx = "failed"
        await expect(req.verify!(undefined, "HASH", undefined)).resolves.toBe("failed")
        expect(req.failedNote!()).toBeUndefined()
        chain.proposal = proposalOf({ status: "EXECUTED" })
        await expect(req.verify!(undefined, "HASH", undefined)).resolves.toBe("failed")
        expect(req.failedNote!()).toBe("another member executed proposal #7 first. Your transaction was refused and did not take effect; the network fee was still charged.")
    })

    it("does not confirm what it cannot see, and says when the proposal is executed but this transaction is not visible", async () => {
        const req = executeRequest(ctx())
        chain.tx = true
        await expect(req.verify!(undefined, "HASH", undefined)).resolves.toBe(false)
        expect(req.pendingNote!()).toBeUndefined()
        chain.tx = false
        chain.proposal = proposalOf({ status: "EXECUTED" })
        await expect(req.verify!(undefined, "HASH", undefined)).resolves.toBe(false)
        expect(req.pendingNote!()).toBe("Proposal #7 reads as executed; this transaction isn't visible yet. Don't send it again.")
    })
})

describe("executeWindow · a margin inside the contract's window", () => {
    const p = proposalOf({ executable_at: 1_000, execute_by: 2_000 })
    it.each([
        [999, "too-early"], [1_009, "too-early"], [1_010, "open"], [1_970, "open"], [1_971, "closing"], [2_000, "closing"], [2_001, "closed"],
    ] as const)("at %i it is %s", (at, state) => {
        expect(executeWindow(p, at)).toBe(state)
    })
    it("is not open for a proposal that isn't accepted", () => {
        expect(executeWindow(proposalOf({ status: "EXECUTED", executable_at: 1_000, execute_by: 2_000 }), 1_500)).toBe("not-accepted")
    })
})

describe("actionProblem · what the contract validates again at execution", () => {
    const m = (address: string, votingPower = 1) => ({ address, roles: [], tier: "", votingPower, username: "" })
    const act = (kind: MembaV2Proposal["action"]["kind"]) => ({ kind, target: "g1target", power: 1, roles: [] })
    it.each([
        ["adding a member who already is one", act("add_member"), [m("g1a"), m("g1target")], "g1target is already a member, so the chain would refuse this execution."],
        ["adding a member to a full DAO", act("add_member"), Array.from({ length: 100 }, (_, i) => m(`g1m${i}`)), "The DAO already has 100 members, its limit, so the chain would refuse this execution."],
        ["removing someone who is no longer a member", act("remove_member"), [m("g1a"), m("g1b")], "g1target is no longer a member, so the chain would refuse this execution."],
        ["removing the last member", act("remove_member"), [m("g1target")], "g1target is the DAO's last member with voting power, so the chain would refuse this execution."],
        ["removing the last voting power", act("remove_member"), [m("g1a", 0), m("g1target", 3)], "g1target is the DAO's last member with voting power, so the chain would refuse this execution."],
        ["changing the roles of someone who left", act("set_roles"), [m("g1a")], "g1target is no longer a member, so the chain would refuse this execution."],
    ])("refuses %s", (_what, a, members, message) => {
        expect(actionProblem(a, members)).toBe(message)
    })
    it.each([
        ["adding a newcomer to a DAO below its limit", act("add_member"), Array.from({ length: 99 }, (_, i) => m(`g1m${i}`))],
        ["removing one of two members", act("remove_member"), [m("g1a"), m("g1target")]],
        ["changing a member's roles", act("set_roles"), [m("g1target")]],
        ["a text proposal", { kind: "text" as const, target: "", power: 0, roles: [] }, []],
    ])("accepts %s", (_what, a, members) => {
        expect(actionProblem(a, members)).toBeNull()
    })
})

describe("executeRequest · re-checks before the wallet (as on the classic proposal page)", () => {
    it("passes when nothing changed, without reading the DAO again", async () => {
        const c = ctx()
        await expect(executeRequest(c).recheck!(undefined)).resolves.toBeUndefined()
        expect(c.refresh).not.toHaveBeenCalled()
    })

    it.each([
        ["the DAO is no longer a version-2 DAO", () => { chain.config = null }, "availability changed"],
        ["the DAO is archived", () => { chain.config = { v2: { archived: true, electorate_version: 3 } } }, "availability changed"],
        ["the member left", () => { chain.members = [{ address: "g1other", votingPower: 1 }] }, "membership"],
        ["the electorate changed", () => { chain.config = { v2: { archived: false, electorate_version: 4 } } }, "members changed"],
        ["the window has not opened", () => { chain.proposal = proposalOf({ executable_at: nowSeconds() + 600 }) }, "cannot be executed now"],
        ["the window opened less than 10 s ago", () => { chain.proposal = proposalOf({ executable_at: nowSeconds() - 5 }) }, "cannot be executed now"],
        ["the window closes in less than 30 s", () => { chain.proposal = proposalOf({ execute_by: nowSeconds() + 20 }) }, "cannot be executed now"],
        ["the window has closed", () => { chain.proposal = proposalOf({ execute_by: nowSeconds() - 60 }) }, "cannot be executed now"],
        ["it was already executed", () => { chain.proposal = proposalOf({ status: "EXECUTED" }) }, "cannot be executed now"],
        ["the member to add already joined", () => {
            chain.proposal = action("add_member")
            chain.members.push({ address: "g1target", votingPower: 1 })
        }, "g1target is already a member, so the chain would refuse this execution."],
        ["the member to remove already left", () => { chain.proposal = action("remove_member") }, "g1target is no longer a member"],
        ["the member whose roles change already left", () => { chain.proposal = action("set_roles") }, "g1target is no longer a member"],
    ])("stops when %s, and reads the DAO again", async (_what, change, message) => {
        change()
        const c = ctx()
        await expect(executeRequest(c).recheck!(undefined)).rejects.toThrow(message)
        expect(c.refresh).toHaveBeenCalledOnce()
    })

    it("names the state's refusal before the fee's, and the fee's when the state holds", async () => {
        const req = executeRequest(ctx())
        quote.ugnotPerThousandGas = 2
        await expect(req.recheck!(undefined)).rejects.toThrow("The network fee increased since review")
        chain.members = []
        await expect(req.recheck!(undefined)).rejects.toThrow("membership")
    })
})
