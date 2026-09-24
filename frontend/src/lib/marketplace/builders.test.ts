/**
 * builders.test.ts — the escrow MsgCall builders, pinned to the realm API.
 *
 * The API table below is copied from the frozen API of `gno.land/r/samcrew/escrow_v4`
 * (escrow.gno and views.gno at its security-reviewed revision). It keeps
 * escrow_v3's user API (names, argument order, `title:amount` milestones, exact-send
 * funding) and adds ArchiveContract and ExpireUnfunded. Realms are immutable once
 * published: if a builder test here fails, the builder is wrong, not the table.
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
    buildExpireUnfundedMsg,
    buildArchiveContractMsg,
    encodeMilestones,
    ESCROW_LIMITS,
    ESCROW_REFUSED_CODE_POINTS,
    parseMilestonesArg,
    parseUgnotAmount,
    EscrowInputError,
} from "./builders"
import { toAdenaMessages } from "../grc20"

const CLIENT = "g1747t5m2f08plqjlrjk2q0qld7465hxz8gkx59c"
const FREELANCER = "g1u7y667z64x2h7vc6fmpcprgey4ck233jaww9zq"
const ESCROW = "gno.land/r/samcrew/escrow_v4"
const MS = [{ title: "Design", amountUgnot: 5_000_000 }, { title: "Build", amountUgnot: 15_000_000 }]

/**
 * Every user-callable escrow_v4 entrypoint (the `cur realm` parameter is implicit)
 * and who may call it. Admin-only functions (Pause, Unpause, ResolveDispute,
 * TransferOwnership, AcceptOwnership, CancelOwnershipTransfer, ProposeFeeRecipient,
 * AcceptFeeRecipient, CancelFeeRecipientProposal) have no builder: Memba never
 * signs them for a user.
 */
const REALM_API = {
    CreateContract: { params: ["freelancer address", "title string", "description string", "milestones string"], payable: false, caller: "a user (not a realm) other than the freelancer; becomes the client; at most 5 open contracts per client" },
    FundMilestone: { params: ["contractId string", "milestoneIdx int"], payable: true, caller: "client, direct user call, exact milestone amount" },
    CompleteMilestone: { params: ["contractId string", "milestoneIdx int"], payable: false, caller: "freelancer" },
    ReleaseFunds: { params: ["contractId string", "milestoneIdx int"], payable: false, caller: "client or admin" },
    RaiseDispute: { params: ["contractId string", "milestoneIdx int"], payable: false, caller: "client or freelancer" },
    CancelContract: { params: ["contractId string"], payable: false, caller: "client" },
    ClaimRefund: { params: ["contractId string", "milestoneIdx int"], payable: false, caller: "anyone, after 864000 blocks" },
    ClaimDisputeTimeout: { params: ["contractId string", "milestoneIdx int"], payable: false, caller: "anyone, after 806400 blocks" },
    ExpireUnfunded: { params: ["contractId string"], payable: false, caller: "anyone, 864000 blocks after creation, never funded" },
    ArchiveContract: { params: ["contractId string"], payable: false, caller: "client, contract completed or cancelled" },
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
    buildExpireUnfundedMsg(FREELANCER, ESCROW, "0"),
    buildArchiveContractMsg(CLIENT, ESCROW, "0"),
]

describe("escrow builders — realm API", () => {
    it("covers every user-callable realm function, by exact name", () => {
        expect(all().map((m) => m.value.func).sort()).toEqual(Object.keys(REALM_API).sort())
    })

    it("passes arguments in the realm's order, one per parameter", () => {
        const [create, fund, complete, release, dispute, cancel, refund, timeout, expire, archive] = all()
        expect(create.value.args).toEqual([FREELANCER, "Logo", "A logo", "Design:5000000,Build:15000000"])
        for (const m of [fund, complete, release, dispute, refund, timeout]) expect(m.value.args).toEqual(["0", "1"])
        for (const m of [cancel, expire, archive]) expect(m.value.args).toEqual(["0"])
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
        expect(all()[8].value.caller).toBe(FREELANCER)
        expect(all()[9].value.caller).toBe(CLIENT)
    })

    it("archive and expire validate the contract id like every other call", () => {
        for (const id of ["", "01", "-1", "abc"]) {
            expect(() => buildArchiveContractMsg(CLIENT, ESCROW, id), JSON.stringify(id)).toThrow(EscrowInputError)
            expect(() => buildExpireUnfundedMsg(CLIENT, ESCROW, id), JSON.stringify(id)).toThrow(EscrowInputError)
        }
    })

    it("pins the realm constants the UI relies on", () => {
        expect(ESCROW_LIMITS).toEqual({
            maxTitleBytes: 200,
            maxDescriptionBytes: 5000,
            maxMilestones: 20,
            maxMilestoneTitleBytes: 200,
            maxMilestonesArgBytes: 20 * (200 + 64),
            minMilestoneUgnot: 1000,
            maxActivePerClient: 5,
            unfundedExpiryBlocks: 864_000,
            maxPauseBlocks: 183_273,
        })
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

    // escrow.gno sanitizeMilestoneTitle removes these before storing the title,
    // the description and every milestone title; signing them would store other text.
    const STRIPPED = {
        brackets: ["[", "]", "(", ")"],
        markdown: ["#", "*", "`", "!", "_", "~"],
        html: ["<", ">"],
        tables: ["|"],
        escapes: ["\\"],
        whitespace: ["\n", "\r", "\t"],
    }

    it.each(Object.entries(STRIPPED))("refuses characters the realm strips: %s", (_, chars) => {
        for (const c of chars) {
            const inner = `a${c}b`
            expect(() => create({ title: inner }), `title ${JSON.stringify(c)}`).toThrow(EscrowInputError)
            expect(() => create({ description: inner }), `description ${JSON.stringify(c)}`).toThrow(/strips/)
            expect(() => create({ milestones: [{ title: inner, amountUgnot: 1000 }] }), `milestone ${JSON.stringify(c)}`).toThrow(EscrowInputError)
            expect(() => parseMilestonesArg(`${inner}:1000`), `arg ${JSON.stringify(c)}`).toThrow(EscrowInputError)
        }
    })

    it("names the character it refuses", () => {
        expect(() => create({ title: "Logo (v2)" })).toThrow(/"\("/)
        expect(() => create({ description: "line one\nline two" })).toThrow(/line break/)
    })

    it("refuses a title made only of stripped characters, which the realm would store empty", () => {
        expect(() => create({ title: "***" })).toThrow(EscrowInputError)
        expect(() => create({ title: "[]()#*`!<>|\\_~" })).toThrow(EscrowInputError)
        expect(() => create({ milestones: [{ title: "**", amountUgnot: 1000 }] })).toThrow(EscrowInputError)
    })

    it("keeps ordinary punctuation and non-ASCII text", () => {
        expect(() => create({ title: "Logo & brand, v2 — 50% off? «ok» é 🚀", description: "Plain text; with: punctuation. {braces} 'quotes' \"double\" / slash + - = @ $ ^" })).not.toThrow()
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
        expect(() => buildCancelContractMsg(CLIENT, "gno.land/p/samcrew/escrow_v4", "0")).toThrow(EscrowInputError)
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

/**
 * escrow_v4 cleanText refuses invalid UTF-8, control characters and format
 * characters, and strips `[ ] ( ) # * ` ! < > | \ _ ~`, tab, LF and CR. The
 * builders refuse all of them, so what is signed is what is stored. These tables
 * are written out by hand from the realm's rules (C0 and C1 controls, DEL, and
 * the Unicode 15.0.0 \p{Cf} table of the Gno standard library), not derived
 * from the builder's own list.
 */
describe("text validation parity with escrow_v4 cleanText", () => {
    const create = (text: string, where: "title" | "description" | "milestone") =>
        buildCreateContractMsg(
            CLIENT,
            ESCROW,
            FREELANCER,
            where === "title" ? text : "Logo",
            where === "description" ? text : "",
            where === "milestone" ? [{ title: text, amountUgnot: 1000 }] : MS,
        )
    const cp = (n: number) => String.fromCodePoint(n)
    const hexOf = (n: number) => `U+${n.toString(16).toUpperCase().padStart(4, "0")}`

    // Every range the realm refuses, inclusive: [first, last].
    const REFUSED: [number, number][] = [
        [0x0000, 0x0008], [0x000b, 0x000c], [0x000e, 0x001f], [0x007f, 0x009f],
        [0x00ad, 0x00ad], [0x0600, 0x0605], [0x061c, 0x061c], [0x06dd, 0x06dd], [0x070f, 0x070f],
        [0x0890, 0x0891], [0x08e2, 0x08e2], [0x180e, 0x180e], [0x200b, 0x200f], [0x202a, 0x202e],
        [0x2060, 0x2064], [0x2066, 0x206f], [0xfeff, 0xfeff], [0xfff9, 0xfffb], [0x110bd, 0x110bd],
        [0x110cd, 0x110cd], [0x13430, 0x1343f], [0x1bca0, 0x1bca3], [0x1d173, 0x1d17a], [0xe0001, 0xe0001],
        [0xe0020, 0xe007f],
    ]

    // The code points just outside each range, which the realm accepts. 0x09, 0x0A,
    // 0x0D and 0x7E are also outside a range but are stripped, so refused below.
    const ACCEPTED_NEIGHBOURS = [
        0x0020, 0x00a0, 0x00ac, 0x00ae, 0x05ff, 0x0606, 0x061b, 0x061d, 0x06dc, 0x06de, 0x070e, 0x0710,
        0x088f, 0x0892, 0x08e1, 0x08e3, 0x180d, 0x180f, 0x200a, 0x2010, 0x2029, 0x202f, 0x205f, 0x2065,
        0x2070, 0xfefe, 0xff00, 0xfff8, 0xfffc, 0x110bc, 0x110be, 0x110cc, 0x110ce, 0x1342f, 0x13440,
        0x1bc9f, 0x1bca4, 0x1d172, 0x1d17b, 0xe0000, 0xe0002, 0xe001f, 0xe0080,
    ]

    it("the builder's list is exactly the realm's", () => {
        expect(ESCROW_REFUSED_CODE_POINTS.map(([a, b]) => [a, b])).toEqual(REFUSED)
    })

    it.each(REFUSED.map(([lo, hi]) => [hexOf(lo), hexOf(hi), lo, hi] as const))("refuses %s–%s at both ends and inside", (_a, _b, lo, hi) => {
        for (const n of new Set([lo, hi, lo + Math.floor((hi - lo) / 2)])) {
            for (const where of ["title", "description", "milestone"] as const) {
                expect(() => create(`a${cp(n)}b`, where), `${hexOf(n)} in ${where}`).toThrow(EscrowInputError)
            }
            expect(() => create(`a${cp(n)}b`, "title")).toThrow(hexOf(n))
        }
    })

    it.each(ACCEPTED_NEIGHBOURS.map((n) => [hexOf(n), n] as const))("accepts the neighbour %s", (_h, n) => {
        for (const where of ["title", "description", "milestone"] as const) {
            expect(() => create(`a${cp(n)}b`, where), `${hexOf(n)} in ${where}`).not.toThrow()
        }
    })

    it("refuses the characters the realm strips, including the ones between refused ranges", () => {
        for (const c of ["\t", "\n", "\r", "~", "[", "]", "(", ")", "#", "*", "`", "!", "<", ">", "|", "\\", "_"]) {
            expect(() => create(`a${c}b`, "title"), JSON.stringify(c)).toThrow(/strips/)
        }
    })

    it("every refused format character is \\p{Cf} in this JavaScript engine too", () => {
        for (const [lo, hi] of REFUSED.slice(4)) {
            for (let n = lo; n <= hi; n++) expect(/\p{Cf}/u.test(cp(n)), hexOf(n)).toBe(true)
        }
    })

    it("refuses unpaired surrogates, which have no UTF-8 encoding", () => {
        for (const bad of ["a\uD800b", "a\uDFFFb", "\uD83D", "x\uDE80"]) {
            for (const where of ["title", "description", "milestone"] as const) {
                expect(() => create(bad, where), `${JSON.stringify(bad)} in ${where}`).toThrow(/valid UTF-8/)
            }
        }
        expect(() => create("rocket \u{1F680}", "title")).not.toThrow()
    })

    it("refuses a title that is only spaces, as the realm does after trimming", () => {
        for (const blank of [" ", "   ", " ", "　  "]) {
            expect(() => create(blank, "title"), JSON.stringify(blank)).toThrow(/visible characters/)
        }
        expect(() => create(" padded title ", "title")).not.toThrow()
    })

    it("checks byte limits at the edge, in UTF-8", () => {
        expect(() => create("é".repeat(100), "title")).not.toThrow()
        expect(() => create("é".repeat(100) + "x", "title")).toThrow(EscrowInputError)
        expect(() => create("\u{1F680}".repeat(1250), "description")).not.toThrow()
        expect(() => create("\u{1F680}".repeat(1250) + "x", "description")).toThrow(EscrowInputError)
        expect(() => create("日".repeat(66) + "xx", "milestone")).not.toThrow()
        expect(() => create("日".repeat(67), "milestone")).toThrow(EscrowInputError)
    })

    it("the largest milestones argument the builders produce is within the realm's bound", () => {
        const max = encodeMilestones(Array.from({ length: 20 }, () => ({ title: "x".repeat(200), amountUgnot: 999_999_999_999_999 })))
        expect(new TextEncoder().encode(max).length).toBe(4_339)
        expect(4_339).toBeLessThanOrEqual(ESCROW_LIMITS.maxMilestonesArgBytes)
    })
})
