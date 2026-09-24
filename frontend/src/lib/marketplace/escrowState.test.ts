import { beforeEach, describe, expect, it, vi } from "vitest"

const rpc = vi.hoisted(() => ({
    queryEval: vi.fn<(url: string, path: string, expr: string, strict?: boolean) => Promise<string | null>>(async () => null),
    queryRender: vi.fn<(url: string, path: string, renderPath: string, strict?: boolean) => Promise<string | null>>(async () => null),
}))
vi.mock("../dao/shared", async (importOriginal) => ({ ...(await importOriginal<typeof import("../dao/shared")>()), ...rpc }))

import {
    archiveAvailability,
    archiveRefundEstimateUgnot,
    exitsClosedReason,
    expireAvailability,
    formatApproxGnot,
    formatBlocksEta,
    hireAvailability,
    parseContractRender,
    parseQevalBool,
    parseQevalInt,
    readClientActiveCount,
    readEscrowContract,
    readEscrowPauseState,
    type EscrowContractView,
    type EscrowPauseState,
} from "./escrowState"

const CLIENT = "g1747t5m2f08plqjlrjk2q0qld7465hxz8gkx59c"
const FREELANCER = "g1u7y667z64x2h7vc6fmpcprgey4ck233jaww9zq"
const ESCROW = "gno.land/r/samcrew/escrow_v4"

const OPEN: EscrowPauseState = { paused: false, exitsOpen: true, exitsReopenAt: 0, pausedBlocks: 0 }
const BLOCKING: EscrowPauseState = { paused: true, exitsOpen: false, exitsReopenAt: 1_183_273, pausedBlocks: 50_000 }
const LAPSED: EscrowPauseState = { paused: true, exitsOpen: true, exitsReopenAt: 1_183_273, pausedBlocks: 183_273 }

/** Render("contract/7") exactly as render.gno writes it. */
const RENDER = [
    "# Logo design",
    "",
    "A logo — with an em dash, «quotes» and é",
    "",
    "**ID:** 7",
    `**Client:** ${CLIENT}`,
    `**Freelancer:** ${FREELANCER}`,
    "**Status:** completed",
    "**Created:** block 1000",
    "",
    "**Total Value:** 20000000 ugnot",
    "",
    "## Milestones",
    "",
    "- **Sketches — v1** — 5000000 ugnot [released] (funded block 1200) (completed block 1300)",
    "- **Final** — 15000000 ugnot [released] (funded block 1210) (completed block 1400)",
    "",
].join("\n")

const contract = (over: Partial<EscrowContractView> = {}): EscrowContractView => ({
    id: "7",
    title: "Logo",
    description: "",
    client: CLIENT,
    freelancer: FREELANCER,
    status: "active",
    createdAt: 1_000,
    milestones: [{ title: "A", amountUgnot: 1000, status: "pending" }],
    ...over,
})

beforeEach(() => {
    rpc.queryEval.mockReset()
    rpc.queryRender.mockReset()
})

describe("qeval parsing", () => {
    it("reads bools and ints, and nothing else", () => {
        expect(parseQevalBool("(true bool)")).toBe(true)
        expect(parseQevalBool("(false bool)\n")).toBe(false)
        expect(parseQevalInt("(5 int)")).toBe(5)
        expect(parseQevalInt("(1183273 int64)")).toBe(1_183_273)
        for (const bad of [null, "", "true", "(1 bool)", "(\"true\" string)", "(x int)", "(1.5 int64)", "(99999999999999999 int64)"]) {
            expect(parseQevalBool(bad) ?? parseQevalInt(bad), String(bad)).toBeNull()
        }
    })
})

describe("readEscrowPauseState / readClientActiveCount", () => {
    it("reads each PauseState field with a strict query", async () => {
        const answers: Record<string, string> = {
            "PauseState().Paused": "(true bool)",
            "PauseState().ExitsOpen": "(false bool)",
            "PauseState().ExitsReopenAt": "(1183273 int64)",
            "PauseState().PausedBlocks": "(50000 int64)",
        }
        rpc.queryEval.mockImplementation(async (_u, path, expr, strict) => (path === ESCROW && strict ? answers[expr] ?? null : null))
        await expect(readEscrowPauseState(ESCROW)).resolves.toEqual(BLOCKING)
    })

    it("throws when a field cannot be read", async () => {
        rpc.queryEval.mockResolvedValue("(true bool)")
        await expect(readEscrowPauseState(ESCROW)).rejects.toThrow(/pause state/)
    })

    it("reads GetClientActiveCount for a checksummed address only", async () => {
        rpc.queryEval.mockResolvedValue("(3 int)")
        await expect(readClientActiveCount(ESCROW, CLIENT)).resolves.toBe(3)
        expect(rpc.queryEval).toHaveBeenCalledWith(expect.any(String), ESCROW, `GetClientActiveCount("${CLIENT}")`, true)
        await expect(readClientActiveCount(ESCROW, 'g1") + Evil("')).rejects.toThrow(/Invalid/)
        expect(rpc.queryEval).toHaveBeenCalledTimes(1)
    })
})

describe("contract render parsing", () => {
    it("parses render.gno's detail page", () => {
        expect(parseContractRender("7", RENDER)).toEqual({
            id: "7",
            title: "Logo design",
            description: "A logo — with an em dash, «quotes» and é",
            client: CLIENT,
            freelancer: FREELANCER,
            status: "completed",
            createdAt: 1000,
            milestones: [
                { title: "Sketches — v1", amountUgnot: 5_000_000, status: "released" },
                { title: "Final", amountUgnot: 15_000_000, status: "released" },
            ],
        })
    })

    it("parses a contract without a description", () => {
        const md = RENDER.replace("A logo — with an em dash, «quotes» and é\n\n", "")
        expect(parseContractRender("7", md)?.description).toBe("")
    })

    it("reads an unknown or archived id as null, even next to a contract titled 404", () => {
        expect(parseContractRender("7", "# 404\nContract not found: 7")).toBeNull()
        expect(parseContractRender("7", RENDER.replace("# Logo design", "# 404"))?.title).toBe("404")
    })

    it("refuses pages it does not recognise instead of guessing", () => {
        for (const md of ["", "# Escrow Contracts", RENDER.replace("**ID:** 7", "**ID:** 8"), RENDER.replace("completed", "done"), RENDER.replace(`**Client:** ${CLIENT}`, "**Client:** g1bad"), RENDER.replace("[released]", "[paid]")]) {
            expect(() => parseContractRender("7", md), md.slice(0, 40)).toThrow(/Unexpected/)
        }
    })

    it("readEscrowContract queries contract/<id> strictly and validates the id first", async () => {
        rpc.queryRender.mockResolvedValue(RENDER)
        await expect(readEscrowContract(ESCROW, "7")).resolves.toMatchObject({ id: "7", status: "completed" })
        expect(rpc.queryRender).toHaveBeenCalledWith(expect.any(String), ESCROW, "contract/7", true)
        await expect(readEscrowContract(ESCROW, "07")).rejects.toThrow(/Invalid contract id/)
    })
})

describe("hire availability: per-client cap and pause", () => {
    it("allows hiring below the cap when not paused", () => {
        expect(hireAvailability(OPEN, 0, 5_000)).toEqual({ available: true })
        expect(hireAvailability(OPEN, 4, 5_000)).toEqual({ available: true })
    })

    it("refuses at 5 open contracts, with the reason", () => {
        const a = hireAvailability(OPEN, 5, 5_000)
        expect(a.available).toBe(false)
        if (!a.available) expect(a.reason).toMatch(/5 open escrow contracts.*\(5\).*completed or cancelled/)
    })

    it("refuses while paused, including after exits reopen, and gives the reopen block while they are shut", () => {
        const shut = hireAvailability(BLOCKING, 0, 1_000_000)
        expect(shut.available).toBe(false)
        if (!shut.available) expect(shut.reason).toMatch(/paused.*until it is unpaused.*reopen at block 1,183,273 \(about 7 days\)/)
        const lapsed = hireAvailability(LAPSED, 0, 1_200_000)
        expect(lapsed.available).toBe(false)
        if (!lapsed.available) expect(lapsed.reason).not.toMatch(/reopen/)
    })
})

describe("archive availability", () => {
    const settled = contract({ status: "completed", milestones: [{ title: "A", amountUgnot: 1000, status: "released" }] })

    it("is for the client only", () => {
        expect(archiveAvailability(settled, FREELANCER, OPEN, 5_000)).toBeNull()
        expect(archiveAvailability(settled, "", OPEN, 5_000)).toBeNull()
        expect(archiveAvailability(settled, CLIENT, OPEN, 5_000)).toEqual({ available: true })
    })

    it("needs a completed or cancelled contract with nothing escrowed", () => {
        expect(archiveAvailability(contract({ status: "active" }), CLIENT, OPEN, 5_000)).toMatchObject({ available: false })
        expect(archiveAvailability(contract({ status: "disputed" }), CLIENT, OPEN, 5_000)).toMatchObject({ available: false })
        expect(archiveAvailability(contract({ status: "cancelled", milestones: [{ title: "A", amountUgnot: 1000, status: "refunded" }, { title: "B", amountUgnot: 1000, status: "pending" }] }), CLIENT, OPEN, 5_000)).toEqual({ available: true })
        expect(archiveAvailability(contract({ status: "cancelled", milestones: [{ title: "A", amountUgnot: 1000, status: "funded" }] }), CLIENT, OPEN, 5_000)).toMatchObject({ available: false })
    })

    it("is refused inside a pause's blocking window, with the reopen block, and allowed once it lapses", () => {
        const a = archiveAvailability(settled, CLIENT, BLOCKING, 1_100_000)
        expect(a).toMatchObject({ available: false })
        if (a && !a.available) expect(a.reason).toMatch(/reopens at block 1,183,273 \(about 3 days\), even if nobody unpauses/)
        expect(archiveAvailability(settled, CLIENT, LAPSED, 1_200_000)).toEqual({ available: true })
    })

    it("estimates the refund from the stored text", () => {
        const refund = archiveRefundEstimateUgnot(contract({ title: "L", milestones: [{ title: "A", amountUgnot: 1000, status: "released" }] }))
        expect(refund).toBe((3_780 + 1 + 1 + 889) * 100)
        expect(formatApproxGnot(refund)).toBe("~0.47 GNOT")
    })
})

describe("expire availability", () => {
    it("applies only to an active contract none of whose milestones was funded", () => {
        expect(expireAvailability(contract({ status: "cancelled" }), OPEN, 900_000)).toBeNull()
        expect(expireAvailability(contract({ milestones: [{ title: "A", amountUgnot: 1000, status: "pending" }, { title: "B", amountUgnot: 1000, status: "refunded" }] }), OPEN, 900_000)).toBeNull()
    })

    it("is not yet available before UnfundedExpiryBlks, and says from which block", () => {
        const a = expireAvailability(contract(), OPEN, 864_999)
        expect(a).toMatchObject({ available: false })
        if (a && !a.available) expect(a.reason).toMatch(/from block 865,000 \(about 1 minute\)/)
    })

    it("is available from createdAt + 864000", () => {
        expect(expireAvailability(contract(), OPEN, 865_000)).toEqual({ available: true })
    })

    it("is refused inside a blocking window", () => {
        expect(expireAvailability(contract(), BLOCKING, 1_100_000)).toMatchObject({ available: false })
    })

    it("after a pause, warns that the deadline may have moved by up to the paused blocks", () => {
        const a = expireAvailability(contract(), LAPSED, 900_000)
        expect(a).toMatchObject({ available: true })
        if (a?.available) expect(a.note).toMatch(/up to 183,273 blocks/)
        expect(expireAvailability(contract(), LAPSED, 865_000 + 183_273)).toEqual({ available: true })
    })

    it("needs the current height", () => {
        expect(expireAvailability(contract(), OPEN, 0)).toMatchObject({ available: false })
    })
})

describe("time estimates", () => {
    it("formats blocks at about 3.3 s each", () => {
        expect(formatBlocksEta(1)).toBe("about 1 minute")
        expect(formatBlocksEta(1_000)).toBe("about 55 minutes")
        expect(formatBlocksEta(10_000)).toBe("about 9 hours")
        expect(formatBlocksEta(183_273)).toBe("about 7 days")
    })

    it("names no reopen time when exits are open", () => {
        expect(exitsClosedReason(OPEN, 10)).toBeNull()
        expect(exitsClosedReason(LAPSED, 10)).toBeNull()
    })
})
