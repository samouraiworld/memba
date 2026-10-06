import { beforeEach, describe, expect, it, vi } from "vitest"

const chain = vi.hoisted(() => ({
    config: { v2: { archived: false, electorate_version: 3 } } as { v2: { archived: boolean; electorate_version: number } } | null,
    members: [{ address: "g1member" }] as { address: string }[],
    proposal: { electorate_version: 3, open: true },
    voted: false as boolean | null,
    choice: null as "YES" | "NO" | "ABSTAIN" | null,
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
    findV2VoterChoice: vi.fn(async () => chain.choice),
}))
// A fresh quote at the reviewed price (1 ugnot per 1,000 gas, with 20% headroom) unless a test raises it.
const quote = vi.hoisted(() => ({ ugnotPerThousandGas: 1 }))
vi.mock("../../lib/grc20", async (orig) => ({
    ...(await orig<typeof import("../../lib/grc20")>()),
    freshFeeForGasWanted: vi.fn(async (gasWanted: number) => Math.ceil((gasWanted * 1.2 * quote.ugnotPerThousandGas) / 1000)),
    networkGasPriceFresh: vi.fn(async () => ({ gas: 1000, ugnot: quote.ugnotPerThousandGas })),
}))
vi.mock("../../lib/dao/daoTx", async (orig) => ({
    ...(await orig<typeof import("../../lib/dao/daoTx")>()),
    broadcastDaoTx: vi.fn(async () => ({ hash: "HASH" })),
}))
vi.mock("../../lib/dao/v2Lifecycle", async (orig) => ({
    ...(await orig<typeof import("../../lib/dao/v2Lifecycle")>()),
    canVoteNow: vi.fn(() => chain.proposal.open),
}))

import { FALLBACK_GAS_PRICE } from "../../lib/grc20"
import { broadcastDaoTx } from "../../lib/dao/daoTx"
import { voteRequest, type VoteContext } from "./voteRequest"
import type { ProposalView } from "./useOsDao"

const proposal: ProposalView = {
    id: 7, title: "Adopt the charter", description: "", statusLabel: "Active", open: true, yes: 0, no: 0, abstain: 0,
    whole: 10, unit: "power", tallyKnown: true, author: "g1author", endsAt: null, electorateVersion: 3, v2: null,
}
const ctx = (over: Partial<VoteContext> = {}): VoteContext => ({
    kind: "memba-v2", realmPath: "gno.land/r/alice/team", daoName: "Team", proposal, caller: "g1member", electorateVersion: 3, power: 2,
    gasPrice: { gas: 1000, ugnot: 1 }, ...over,
})

beforeEach(() => {
    chain.config = { v2: { archived: false, electorate_version: 3 } }
    chain.members = [{ address: "g1member" }]
    chain.proposal = { electorate_version: 3, open: true }
    chain.voted = false
    chain.choice = null
    quote.ugnotPerThousandGas = 1
    localStorage.clear()
})

describe("voteRequest · version-2 re-checks (as on the classic proposal page)", () => {
    it("passes when nothing changed", async () => {
        await expect(voteRequest(ctx()).recheck!("Yes")).resolves.toBeUndefined()
    })

    it("reads the DAO and the network price at the same time", async () => {
        const { getDAOConfig } = await import("../../lib/dao")
        const { freshFeeForGasWanted } = await import("../../lib/grc20")
        let daoRead!: () => void
        const real = vi.mocked(getDAOConfig).getMockImplementation()!
        vi.mocked(getDAOConfig).mockImplementationOnce((...a) => new Promise((resolve) => { daoRead = () => resolve(real(...a)) }))
        vi.mocked(freshFeeForGasWanted).mockClear()
        const checking = voteRequest(ctx()).recheck!("Yes")
        await vi.waitFor(() => expect(daoRead).toBeTypeOf("function"))
        // The DAO hasn't answered, and the price is already asked.
        await vi.waitFor(() => expect(freshFeeForGasWanted).toHaveBeenCalled())
        daoRead()
        await expect(checking).resolves.toBeUndefined()
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
    it("verifies the chosen vote after the member's record is found beyond the first page", async () => {
        chain.voted = true
        chain.choice = "NO"
        const req = voteRequest(ctx())
        await expect(req.verify!("No", "hash", undefined)).resolves.toBe(true)
        await expect(req.verify!("Yes", "hash", undefined)).resolves.toBe(false)
        chain.choice = null
        await expect(req.verify!("No", "hash", undefined)).resolves.toBe(false)
    })

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

describe("voteRequest · the network fee", () => {
    it("shows the network price for the vote's gas limit, and sends exactly that fee", () => {
        const req = voteRequest(ctx())
        const lines = new Map(req.lines("Yes"))
        expect(lines.get("Network fee")).toBe("0.018 GNOT")
        expect(lines.has("Gas limit")).toBe(false)
        expect(req.note).not.toMatch(/Adena shows/)
    })

    it("says when the price could not be read, and that the fee is re-checked before signing", () => {
        const lines = new Map(voteRequest(ctx({ gasPrice: FALLBACK_GAS_PRICE })).lines("Yes"))
        expect(lines.get("Network fee (price not read; re-checked before signing)")).toBe("0.018 GNOT")
    })

    it("sends exactly the fee shown, with the gas limit it pays for", async () => {
        const req = voteRequest(ctx())
        const beforeSign = async () => {}
        await req.send("No", beforeSign)
        expect(broadcastDaoTx).toHaveBeenCalledWith(expect.objectContaining({ gasWanted: 15_000_000 }), "Vote NO on proposal #7", beforeSign,
            { approvedDepositUgnot: undefined, fee: { gasWanted: 15_000_000, gasFee: 18_000 } })
    })

    it("checks a fee set in Settings against what the chain charges, without Memba's headroom, and says to raise it there", async () => {
        localStorage.setItem("memba_settings", JSON.stringify({ gasFee: 10_000, gasWanted: 10_000_000 }))
        const req = voteRequest(ctx({ kind: "memba-v1", realmPath: "gno.land/r/team/dao", electorateVersion: null, power: null }))
        expect(new Map(req.lines("Yes")).get("Network fee (set in Settings)")).toBe("0.01 GNOT")
        // 10,000,000 gas at 1 ugnot per 1,000 needs exactly 10,000: enough.
        await expect(req.recheck!("Yes")).resolves.toBeUndefined()
        quote.ugnotPerThousandGas = 2
        await expect(req.recheck!("Yes")).rejects.toThrow("The fee set in Settings is below what the network now charges for this gas limit. Nothing was sent: raise it in Settings, then review again.")
    })

    it("shows the fee set in Settings for a DAO without a measured budget", () => {
        const lines = new Map(voteRequest(ctx({ kind: "memba-v1", realmPath: "gno.land/r/team/dao", electorateVersion: null, power: null })).lines("Yes"))
        expect(lines.get("Network fee (set in Settings)")).toBe("1 GNOT")
    })

    it("prices a GovDAO vote from its measured gas limit and caps its storage deposit", () => {
        const lines = new Map(voteRequest(ctx({ kind: "govdao", realmPath: "gno.land/r/gov/dao", electorateVersion: null, power: null })).lines("Yes"))
        // 28M gas at 1 ugnot per 1,000, with 20% headroom.
        expect(lines.get("Network fee")).toBe("0.0336 GNOT")
        expect(lines.get("Storage deposit")).toBe("up to 1 GNOT")
    })

    it("stops before the wallet when a fresh quote no longer covers the fee shown", async () => {
        const req = voteRequest(ctx())
        await expect(req.recheck!("Yes")).resolves.toBeUndefined()
        quote.ugnotPerThousandGas = 2
        await expect(req.recheck!("Yes")).rejects.toThrow("The network fee increased since review")
    })
})
