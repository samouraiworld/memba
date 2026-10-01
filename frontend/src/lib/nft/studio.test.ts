import { beforeEach, describe, expect, it, vi } from "vitest"

const reads = vi.hoisted(() => ({ queryEval: vi.fn() }))
vi.mock("../dao/shared", async (original) => ({ ...(await original<object>()), queryEval: reads.queryEval }))

import { NFT_DROPS_PATH, type NftStage } from "./drops"
import { NFT_LEDGER_PATH, countCollections, listCollectionsPage } from "./ledger"
import { buildAddStageMsg, buildEndStageMsg, stageProblem, type StageTerms } from "./studio"

const CREATOR = "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5"
const NOW = 1_800_000_000n
const DAY = 86_400n
const terms = (more: Partial<StageTerms> = {}): StageTerms => ({
    kind: "fixed", start: NOW + 3_600n, end: NOW + 3_600n + DAY, price: 1_500_000n, floor: 0n, supplyCap: 0n, perWallet: 2n, gate: "", ...more,
})
const stage = (index: number, start: bigint, end: bigint, more: Partial<NftStage> = {}): NftStage => ({
    index, kind: "fixed", start, end, open: false, price: 1n, floor: 0n, currentPrice: 1n, currency: "ugnot", feeBPS: 200n, supplyCap: 0n,
    perWallet: 1n, root: "", gate: "", minted: 0n, ...more,
})

describe("stage terms", () => {
    it("takes the stages the realm takes", () => {
        expect(stageProblem(terms(), NOW)).toBe("")
        expect(stageProblem(terms({ kind: "dutch", price: 10n, floor: 0n }), NOW)).toBe("")
        expect(stageProblem(terms({ kind: "holder", price: 0n, gate: "C2" }), NOW)).toBe("")
        expect(stageProblem(terms({ start: NOW + 60n, end: NOW + 60n + 365n * DAY, perWallet: 1_000_000n }), NOW)).toBe("")
        // Windows that touch do not overlap: [start, end).
        expect(stageProblem(terms(), NOW, [stage(0, NOW - DAY, NOW + 3_600n)])).toBe("")
    })

    it.each<[string, Partial<StageTerms>, RegExp]>([
        ["a start less than a minute away", { start: NOW + 59n }, /at least a minute from now/],
        ["an end at the start", { end: NOW + 3_600n }, /end after it starts/],
        ["a window over a year", { end: NOW + 3_601n + 365n * DAY }, /at most a year/],
        ["a negative price", { price: -1n }, /^The price/],
        ["a negative cap", { supplyCap: -1n }, /stage cap/],
        ["no wallet limit", { perWallet: 0n }, /between 1 and 1,000,000/],
        ["a wallet limit over a million", { perWallet: 1_000_001n }, /between 1 and 1,000,000/],
        ["a floor on a fixed stage", { floor: 1n }, /floor/],
        ["a dutch floor at the price", { kind: "dutch", price: 10n, floor: 10n }, /floor below its starting price/],
        ["a holder stage without a gate", { kind: "holder", gate: "" }, /Name the collection/],
        ["a malformed gate", { kind: "holder", gate: "C01" }, /Name the collection/],
        ["a gate on a fixed stage", { gate: "C2" }, /Only a holder stage/],
    ])("refuses %s", (_, more, problem) => {
        expect(stageProblem(terms(more), NOW)).toMatch(problem)
    })

    it("refuses an overlapping window and an eleventh stage", () => {
        expect(stageProblem(terms(), NOW, [stage(0, NOW, NOW + 3_601n)])).toBe("The window overlaps stage 1.")
        expect(stageProblem(terms(), NOW, Array.from({ length: 10 }, (_, i) => stage(i, BigInt(i), BigInt(i) + 1n)))).toMatch(/used them all/)
    })
})

describe("stage calls", () => {
    it("schedules a stage with every term in the realm's order and the fee the creator read", () => {
        expect(buildAddStageMsg(CREATOR, "C1", terms({ kind: "holder", gate: "C2", supplyCap: 50n }), 200n, NOW, [])).toEqual({
            type: "vm/MsgCall",
            value: {
                caller: CREATOR, send: "", pkg_path: NFT_DROPS_PATH, func: "AddStage",
                args: ["C1", "holder", String(NOW + 3_600n), String(NOW + 3_600n + DAY), "1500000", "0", "50", "2", "", "C2", "ugnot", "200"],
                max_deposit: "700000ugnot",
            },
        })
        expect(() => buildAddStageMsg(CREATOR, "C1", terms({ perWallet: 0n }), 200n, NOW, [])).toThrow(/between 1 and/)
        expect(() => buildAddStageMsg(CREATOR, "C1", terms(), -1n, NOW, [])).toThrow("Invalid maximum fee")
    })

    it("ends an open stage only", () => {
        expect(buildEndStageMsg(CREATOR, "C1", stage(3, 1n, 2n, { open: true })).value).toMatchObject({ func: "EndStage", args: ["C1", "3"], send: "", max_deposit: "100000ugnot" })
        expect(() => buildEndStageMsg(CREATOR, "C1", stage(3, 1n, 2n))).toThrow("Only an open stage")
    })
})

describe("collection pages", () => {
    beforeEach(() => reads.queryEval.mockReset())
    const summary = (n: number) => ({ id: `C${n}`, creator: CREATOR, name: "N", symbol: "S", image: "", mode: "open", maxSupply: "0", sealed: false, minted: "0" })
    const answer = (value: unknown) => `(${JSON.stringify(JSON.stringify(value))} string)`

    it("reads one page in creation order, each row where its ID says", async () => {
        reads.queryEval.mockResolvedValueOnce(answer([summary(51), summary(52)]))
        expect((await listCollectionsPage(1n, 50)).map((row) => row.id)).toEqual(["C51", "C52"])
        expect(reads.queryEval.mock.calls[0].slice(1, 3)).toEqual([NFT_LEDGER_PATH, "ListCollectionsJSON(1, 50)"])
        reads.queryEval.mockResolvedValueOnce(answer([summary(52)]))
        await expect(listCollectionsPage(1n, 50)).rejects.toThrow("Inconsistent collection list")
        await expect(listCollectionsPage(-1n, 50)).rejects.toThrow("Invalid collection page")
    })

    it("counts the collections", async () => {
        reads.queryEval.mockResolvedValueOnce("(7 int64)")
        expect(await countCollections()).toBe(7n)
    })
})
