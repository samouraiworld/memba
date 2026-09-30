import { beforeEach, describe, expect, it, vi } from "vitest"
import { LedgerReadError, NFT_LEDGER_PATH, listNewestCollections } from "./ledger"

const queryEval = vi.hoisted(() => vi.fn())
vi.mock("../dao/shared", async (original) => ({ ...(await original<typeof import("../dao/shared")>()), queryEval }))

/**
 * What the ledger realm itself printed for `ListCollectionsJSON(0, 50)` after
 * creating an open collection and a revocable soulbound one of three (its unit
 * test helper, gno test at feat/t4-nft-origin 1f424c6). Copied, not built from
 * this reader's model, so a change of the realm's contract breaks this test.
 */
const REALM_LIST = `[{"id":"C1","creator":"g1den8gttrwfjkzar0wf047h6lta047h6l69tljg","name":"Sample","symbol":"SAMPLE","image":"ipfs://image","mode":"open","maxSupply":"0","sealed":false,"minted":"0"},{"id":"C2","creator":"g1den8gttrwfjkzar0wf047h6lta047h6l69tljg","name":"Sample","symbol":"SAMPLE","image":"ipfs://image","mode":"soulbound","maxSupply":"3","sealed":false,"minted":"0"}]`
const CREATOR = "g1den8gttrwfjkzar0wf047h6lta047h6l69tljg"

const summary = { id: "C1", creator: CREATOR, name: "Founders", symbol: "FND", image: "", mode: "open", maxSupply: "0", sealed: false, minted: "2" }
const row = (n: number, extra: object = {}) => ({ ...summary, id: `C${n}`, ...extra })
const without = (value: object, key: string) => Object.fromEntries(Object.entries(value).filter(([name]) => name !== key))
/** A qeval answer: the realm's JSON as a Go-quoted string. */
const quoted = (json: string) => `(${JSON.stringify(json)} string)`

/** The ledger as the chain would answer: `total` collections, and `rows` for a page when given. */
function ledger(total: number, rows?: (page: number, size: number) => unknown[]) {
    queryEval.mockImplementation(async (_rpc: string, _path: string, expr: string) => {
        if (expr === "Count()") return `(${total} int64)`
        const page = /^ListCollectionsJSON\((\d+), (\d+)\)$/.exec(expr)
        if (!page) throw new Error(`unexpected query ${expr}`)
        const [index, size] = [Number(page[1]), Number(page[2])]
        const all = Array.from({ length: total }, (_, n) => row(n + 1))
        return quoted(JSON.stringify(rows ? rows(index, size) : all.slice(index * size, (index + 1) * size)))
    })
}

const ids = (collections: { id: string }[]) => collections.map((collection) => collection.id)

describe("newest collections", () => {
    beforeEach(() => { queryEval.mockReset() })

    it("reads the realm's own answer", async () => {
        queryEval.mockImplementation(async (_rpc: string, _path: string, expr: string) => expr === "Count()" ? "(2 int64)" : quoted(REALM_LIST))
        await expect(listNewestCollections("rpc")).resolves.toEqual({
            total: 2n,
            collections: [
                { id: "C2", creator: CREATOR, name: "Sample", symbol: "SAMPLE", image: "ipfs://image", mode: "soulbound", maxSupply: 3n, sealed: false, minted: 0n },
                { id: "C1", creator: CREATOR, name: "Sample", symbol: "SAMPLE", image: "ipfs://image", mode: "open", maxSupply: 0n, sealed: false, minted: 0n },
            ],
        })
        expect(queryEval).toHaveBeenCalledWith("rpc", NFT_LEDGER_PATH, "Count()", true)
        expect(queryEval).toHaveBeenCalledWith("rpc", NFT_LEDGER_PATH, "ListCollectionsJSON(0, 20)", true)
    })

    it("reads an empty ledger as empty, without listing", async () => {
        ledger(0)
        await expect(listNewestCollections("rpc")).resolves.toEqual({ total: 0n, collections: [] })
        expect(queryEval).toHaveBeenCalledTimes(1)
    })

    it.each([
        [1, 20, [0], ["C1"]],
        [20, 20, [0], Array.from({ length: 20 }, (_, n) => `C${20 - n}`)],
        [40, 20, [1], Array.from({ length: 20 }, (_, n) => `C${40 - n}`)],
        [45, 20, [1, 2], Array.from({ length: 20 }, (_, n) => `C${45 - n}`)],
        [7, 5, [0, 1], ["C7", "C6", "C5", "C4", "C3"]],
    ])("of %d collections shows the %d newest, newest first", async (total, size, pages, expected) => {
        ledger(total)
        const newest = await listNewestCollections("rpc", size)
        expect(newest.total).toBe(BigInt(total))
        expect(ids(newest.collections)).toEqual(expected)
        const lists = queryEval.mock.calls.map((call) => call[2]).filter((expr: string) => expr !== "Count()")
        expect(lists).toEqual(pages.map((index) => `ListCollectionsJSON(${index}, ${size})`))
    })

    it("leaves out a collection created between the count and the list", async () => {
        ledger(3, (index) => index === 0 ? [row(1), row(2), row(3), row(4)] : [])
        expect(ids((await listNewestCollections("rpc", 5)).collections)).toEqual(["C3", "C2", "C1"])
    })

    it.each([
        ["a gap in the IDs", (index: number) => index === 0 ? [row(1), row(3), row(4)] : []],
        ["rows out of order", (index: number) => index === 0 ? [row(2), row(1), row(3)] : []],
    ])("refuses %s", async (_name, rows) => {
        ledger(3, rows)
        await expect(listNewestCollections("rpc", 5)).rejects.toThrow(/^Inconsistent collection list$/)
    })

    it("reads fewer rows than counted as a read to try again, never as the whole list", async () => {
        ledger(3, (index) => index === 0 ? [row(1), row(2)] : [])
        const short = listNewestCollections("rpc", 5)
        await expect(short).rejects.toBeInstanceOf(LedgerReadError)
        await expect(short).rejects.toThrow("Could not read every collection counted")
        // The largest count an int64 holds is a count; the pages behind it are short here.
        ledger(0, () => [])
        queryEval.mockResolvedValueOnce("(9223372036854775807 int64)")
        await expect(listNewestCollections("rpc")).rejects.toBeInstanceOf(LedgerReadError)
    })

    it("reports a read that reached no answer as retryable, never as an empty list", async () => {
        queryEval.mockResolvedValueOnce(null)
        const failed = listNewestCollections("rpc")
        await expect(failed).rejects.toBeInstanceOf(LedgerReadError)
        await expect(failed).rejects.toThrow("Could not read collection count")
        queryEval.mockRejectedValueOnce(new Error("abci error"))
        await expect(listNewestCollections("rpc")).rejects.toBeInstanceOf(LedgerReadError)
    })

    it.each(["12", "(-1 int64)", "(01 int64)", "(9223372036854775808 int64)", "(9223372036854775808999 int64)", "(3 uint64)"])("refuses the count %s", async (count) => {
        queryEval.mockResolvedValueOnce(count)
        const failed = listNewestCollections("rpc")
        await expect(failed).rejects.toThrow("Invalid collection count")
        await expect(failed).rejects.not.toBeInstanceOf(LedgerReadError)
    })

    it.each([
        ["an answer that is not a list", { collections: [] }, "Invalid collection list"],
        ["more rows than the page size", Array.from({ length: 21 }, (_, n) => row(n + 1)), "Invalid collection list"],
        ["a full record where a summary is expected", [{ ...summary, description: "" }], "Invalid collection summary fields"],
        ["a summary with a missing field", [without(summary, "image")], "Invalid collection summary fields"],
        ["a malformed collection ID", [row(1, { id: "C01" })], "Invalid collection ID"],
        ["a collection ID longer than a uint64", [row(1, { id: `C1${"0".repeat(20)}` })], "Invalid collection ID"],
        ["an address with a broken checksum", [row(1, { creator: `g1${"q".repeat(38)}` })], "Invalid creator"],
        ["an address in capitals", [row(1, { creator: CREATOR.toUpperCase() })], "Invalid creator"],
        ["an unknown mode", [row(1, { mode: "tradable" })], "Invalid collection mode"],
        ["more minted than the maximum supply", [row(1, { maxSupply: "1" })], "Inconsistent collection supply"],
        ["a supply above int64", [row(1, { minted: "9223372036854775808" })], "Invalid minted count"],
        ["a supply that is not a decimal string", [row(1, { minted: 2 })], "Invalid minted count"],
        ["a sealed flag that is not a boolean", [row(1, { sealed: 0 })], "Invalid sealed"],
        ["a name that is not text", [row(1, { name: null })], "Invalid name"],
        ["an empty name", [row(1, { name: "" })], "Invalid name"],
        ["a name over 32 bytes", [row(1, { name: "é".repeat(17) })], "Invalid name"],
        ["a name with markup", [row(1, { name: "**Admin**" })], "Invalid name"],
        ["a name with a line break", [row(1, { name: "A\nB" })], "Invalid name"],
        ["a name with surrounding space", [row(1, { name: " Founders" })], "Invalid name"],
        ["a lowercase symbol", [row(1, { symbol: "fnd" })], "Invalid symbol"],
        ["a symbol over 10 characters", [row(1, { symbol: "ABCDEFGHIJK" })], "Invalid symbol"],
        ["an image on another scheme", [row(1, { image: "http://example.org/a.png" })], "Invalid image"],
        ["an image with a quote", [row(1, { image: "ipfs://a\"b" })], "Invalid image"],
        ["an image over 200 bytes", [row(1, { image: `ipfs://${"a".repeat(194)}` })], "Invalid image"],
    ])("refuses %s", async (_name, rows, message) => {
        ledger(1, () => rows as unknown[])
        const failed = listNewestCollections("rpc")
        await expect(failed).rejects.toThrow(new RegExp(`^${message}$`))
        await expect(failed).rejects.not.toBeInstanceOf(LedgerReadError)
    })

    it("accepts what the realm accepts at its limits", async () => {
        ledger(1, () => [row(1, { name: "é".repeat(16), symbol: "ABCDEFGHIJ", image: `ipfs://${"a".repeat(193)}` })])
        await expect(listNewestCollections("rpc")).resolves.toMatchObject({ total: 1n })
    })

    it.each([0, 51, 1.5, -1])("never asks the chain for %d collections", async (size) => {
        await expect(listNewestCollections("rpc", size)).rejects.toThrow("Invalid collection page")
        expect(queryEval).not.toHaveBeenCalled()
    })
})
