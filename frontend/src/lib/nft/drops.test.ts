import { beforeEach, describe, expect, it, vi } from "vitest"
import { GNO_RPC_URL } from "../config"
import { bech32Encode } from "../dao/realmAddress"
import { AbciQueryError } from "../rpcFallback"
import { NFT_DROPS_PATH, gateUsed, getDropTerms, listStages, mintedBy } from "./drops"
import { ReadError, RealmRefusedError } from "./read"

const queryEval = vi.hoisted(() => vi.fn())
vi.mock("../dao/shared", async (original) => ({ ...(await original<typeof import("../dao/shared")>()), queryEval }))

/** Sixteen addresses with valid checksums, in strictly ascending order. */
const ADDRESSES = Array.from({ length: 16 }, (_, n) => bech32Encode("g", new Uint8Array(20).fill(n))).sort()
const addr = (n: number) => ADDRESSES[n]
const HASH = "a".repeat(64)
const qeval = (value: unknown) => `(${JSON.stringify(JSON.stringify(value))} string)`
const answer = (value: unknown) => queryEval.mockResolvedValueOnce(qeval(value))
const without = (row: Record<string, unknown>, key: string) => Object.fromEntries(Object.entries(row).filter(([name]) => name !== key))

const fixed = {
    index: 0, kind: "fixed", start: "1000", end: "2000", open: false, price: "500", floor: "0", currentPrice: "500", currency: "ugnot",
    feeBPS: "250", supplyCap: "0", perWallet: "2", root: "", gate: "", gateLimit: "0", minted: "0",
}
const allowlist = { ...fixed, kind: "allowlist", perWallet: "0", root: HASH }
const holder = { ...fixed, kind: "holder", gate: "C7", gateLimit: "40" }
const dutch = { ...fixed, kind: "dutch", floor: "100", open: true, currentPrice: "300" }
const terms = { currency: "ugnot", collectionFee: "5000000", primaryFeeBPS: "250", maxPrimaryFeeBPS: "500", treasury: addr(9) }

beforeEach(() => queryEval.mockReset())

describe("stages", () => {
    const stages = (rows: unknown) => { answer(rows); return listStages("C1") }
    const stage = (row: unknown) => stages([row])

    it("reads the stages of a collection with every field typed", async () => {
        const later = { ...dutch, index: 1, start: "2000", end: "3000" }
        await expect(stages([fixed, later])).resolves.toEqual([
            { ...fixed, start: 1000n, end: 2000n, price: 500n, floor: 0n, currentPrice: 500n, feeBPS: 250n, supplyCap: 0n, perWallet: 2n, gateLimit: 0n, minted: 0n },
            { ...later, start: 2000n, end: 3000n, price: 500n, floor: 100n, currentPrice: 300n, feeBPS: 250n, supplyCap: 0n, perWallet: 2n, gateLimit: 0n, minted: 0n },
        ])
        expect(queryEval).toHaveBeenCalledWith(GNO_RPC_URL, NFT_DROPS_PATH, 'StagesJSON("C1")', true)
    })

    it("reads which gate tokens open a holder stage", async () => {
        await expect(stage(holder)).resolves.toMatchObject([{ gate: "C7", gateLimit: 40n }])
    })

    it("reads a collection without stages as an empty list", async () => {
        await expect(stages([])).resolves.toEqual([])
    })

    it.each([
        ["an allowlist stage", allowlist],
        ["a holder stage", holder],
        ["a free mint", { ...fixed, price: "0", currentPrice: "0" }],
        ["a stage at the fee cap", { ...fixed, feeBPS: "500" }],
        ["a capped stage minted out", { ...fixed, supplyCap: "3", minted: "3" }],
        ["an uncapped stage with mints", { ...fixed, minted: "9" }],
        ["a dutch stage that has not opened", { ...dutch, open: false, currentPrice: "500" }],
        ["a dutch stage at its starting price", { ...dutch, currentPrice: "500" }],
        ["a dutch stage at its floor", { ...dutch, currentPrice: "100" }],
        ["a dutch stage falling to zero", { ...dutch, floor: "0", currentPrice: "1" }],
        // EndStage at the stage's first second sets its end to its start.
        ["a stage ended when it started", { ...fixed, end: "1000" }],
        ["a dutch stage ended when it started", { ...dutch, end: "1000", open: false, currentPrice: "500" }],
    ])("accepts %s", async (_name, row) => {
        await expect(stage(row)).resolves.toMatchObject([{ kind: row.kind }])
    })

    it("accepts ten stages that follow one another", async () => {
        const rows = Array.from({ length: 10 }, (_, n) => ({ ...fixed, index: n, start: String(1000 * (n + 1)), end: String(1000 * (n + 2)) }))
        await expect(stages(rows)).resolves.toHaveLength(10)
    })

    it.each([
        ["an unknown field", { ...fixed, paused: false }, "Invalid stage fields"],
        ["a missing field", without(fixed, "currentPrice"), "Invalid stage fields"],
        ["a renamed field", { ...without(fixed, "feeBPS"), fee: "250" }, "Invalid stage fields"],
        ["a list where a stage is expected", [fixed], "Invalid stage"],
        ["an index that is not its position", { ...fixed, index: 1 }, "Invalid stage index"],
        ["an index written as a decimal string", { ...fixed, index: "0" }, "Invalid stage index"],
        ["an unknown kind", { ...fixed, kind: "auction" }, "Invalid stage kind"],
        ["a number where a decimal string is expected", { ...fixed, price: 500 }, "Invalid stage price"],
        ["a negative decimal", { ...fixed, floor: "-1" }, "Invalid stage floor"],
        ["an open flag that is not a boolean", { ...fixed, open: "false" }, "Invalid stage open"],
        ["a root that is not text", { ...fixed, root: null }, "Invalid allowlist root"],
        ["a currency that is not a key", { ...fixed, currency: "" }, "Invalid currency"],
        ["an open window that ends when it starts", { ...fixed, end: "1000", open: true }, "Inconsistent stage window"],
        ["a window that ends before it starts", { ...fixed, end: "999" }, "Inconsistent stage window"],
        ["a fee above the cap", { ...fixed, feeBPS: "501" }, "Inconsistent stage fee"],
        ["more minted than the stage cap", { ...fixed, supplyCap: "3", minted: "4" }, "Inconsistent stage supply"],
        ["a fixed stage without a wallet limit", { ...fixed, perWallet: "0" }, "Inconsistent stage terms"],
        ["a fixed stage with a floor", { ...fixed, floor: "1" }, "Inconsistent stage terms"],
        ["a fixed stage with a root", { ...fixed, root: HASH }, "Inconsistent stage terms"],
        ["a fixed stage with a gate", { ...fixed, gate: "C7" }, "Inconsistent stage terms"],
        ["a fixed stage with a gate limit", { ...fixed, gateLimit: "3" }, "Inconsistent stage terms"],
        ["a holder stage without its gate limit", without(holder, "gateLimit"), "Invalid stage fields"],
        ["an allowlist stage with a wallet limit", { ...allowlist, perWallet: "1" }, "Inconsistent stage terms"],
        ["an allowlist stage without a root", { ...allowlist, root: "" }, "Inconsistent stage terms"],
        ["an allowlist root that is not lowercase hex", { ...allowlist, root: "A".repeat(64) }, "Inconsistent stage terms"],
        ["an allowlist root of the wrong length", { ...allowlist, root: "a".repeat(63) }, "Inconsistent stage terms"],
        ["an allowlist stage with a gate", { ...allowlist, gate: "C7" }, "Inconsistent stage terms"],
        ["an allowlist stage with a floor", { ...allowlist, floor: "1" }, "Inconsistent stage terms"],
        ["a holder stage without a gate", { ...holder, gate: "" }, "Invalid collection ID"],
        ["a holder gate that is not a collection ID", { ...holder, gate: "gno.land/r/demo/nft" }, "Invalid collection ID"],
        ["a holder stage without a wallet limit", { ...holder, perWallet: "0" }, "Inconsistent stage terms"],
        ["a holder stage with a root", { ...holder, root: HASH }, "Inconsistent stage terms"],
        ["a dutch stage whose floor is its price", { ...dutch, floor: "500" }, "Inconsistent stage terms"],
        ["a dutch stage whose floor is above its price", { ...dutch, floor: "501" }, "Inconsistent stage terms"],
        ["a dutch stage with a gate", { ...dutch, gate: "C7" }, "Inconsistent stage terms"],
        ["a dutch stage without a wallet limit", { ...dutch, perWallet: "0" }, "Inconsistent stage terms"],
        ["a dutch price below its floor", { ...dutch, currentPrice: "99" }, "Inconsistent stage price"],
        ["a dutch price above its starting price", { ...dutch, currentPrice: "501" }, "Inconsistent stage price"],
        ["a closed dutch stage off its starting price", { ...dutch, open: false }, "Inconsistent stage price"],
        ["a fixed stage whose current price is not its price", { ...fixed, currentPrice: "499" }, "Inconsistent stage price"],
    ])("rejects %s", async (_name, row, message) => {
        await expect(stage(row)).rejects.toThrow(new RegExp(`^${message}$`))
    })

    it.each([
        ["an answer that is not a list", { stages: [] }, "Invalid stage list"],
        ["a null answer", null, "Invalid stage list"],
        ["eleven stages", Array.from({ length: 11 }, (_, n) => ({ ...fixed, index: n, start: String(1000 * (n + 1)), end: String(1000 * (n + 2)) })), "Invalid stage list"],
        ["stages whose indexes skip a position", [fixed, { ...fixed, index: 2, start: "2000", end: "3000" }], "Invalid stage index"],
        ["two stages that overlap", [fixed, { ...fixed, index: 1, start: "1999", end: "3000" }], "Overlapping stages"],
        ["a stage inside another", [{ ...fixed, end: "9000" }, { ...fixed, index: 1, start: "2000", end: "3000" }], "Overlapping stages"],
    ])("rejects %s", async (_name, rows, message) => {
        await expect(stages(rows)).rejects.toThrow(new RegExp(`^${message}$`))
    })

    it("reports an unreadable or undecodable answer as an error, never as a collection without stages", async () => {
        queryEval.mockResolvedValueOnce(null)
        await expect(listStages("C1")).rejects.toThrow("Could not read stages")
        queryEval.mockResolvedValueOnce("not a qeval answer")
        await expect(listStages("C1")).rejects.toThrow(/^Invalid stages$/)
    })

    it("reports a collection the realm refuses as refused, not as a read to retry", async () => {
        queryEval.mockRejectedValueOnce(new AbciQueryError(`vm/qeval`, "unknown collection"))
        const refused = listStages("C9")
        await expect(refused).rejects.toBeInstanceOf(RealmRefusedError)
        await expect(refused).rejects.not.toBeInstanceOf(ReadError)
    })
})

describe("drop terms", () => {
    const read = (row: unknown) => { answer(row); return getDropTerms("ugnot") }

    it("reads what a collection and a stage cost now", async () => {
        await expect(read(terms)).resolves.toEqual({ ...terms, collectionFee: 5000000n, primaryFeeBPS: 250n, maxPrimaryFeeBPS: 500n })
        expect(queryEval).toHaveBeenCalledWith(GNO_RPC_URL, NFT_DROPS_PATH, 'TermsJSON("ugnot")', true)
        await expect(read({ ...terms, collectionFee: "0", primaryFeeBPS: "0" })).resolves.toMatchObject({ collectionFee: 0n, primaryFeeBPS: 0n })
        await expect(read({ ...terms, primaryFeeBPS: "500", treasury: "" })).resolves.toMatchObject({ primaryFeeBPS: 500n, treasury: "" })
    })

    it("reports a closed lane as null, never as a number", async () => {
        const closed = await read({ ...terms, collectionFee: "-1", primaryFeeBPS: "-1" })
        expect(closed.collectionFee).toBeNull()
        expect(closed.primaryFeeBPS).toBeNull()
        await expect(read({ ...terms, collectionFee: "-1" })).resolves.toMatchObject({ collectionFee: null, primaryFeeBPS: 250n })
    })

    it("reads the terms of a GRC20 currency by its registry key", async () => {
        const key = "gno.land/r/demo/tokens/v1.SAMPLE-1"
        answer({ ...terms, currency: key })
        await expect(getDropTerms(key)).resolves.toMatchObject({ currency: key })
        expect(queryEval).toHaveBeenCalledWith(GNO_RPC_URL, NFT_DROPS_PATH, `TermsJSON("${key}")`, true)
    })

    it.each([
        ["an unknown field", { ...terms, paused: false }, "Invalid drop terms fields"],
        ["a missing field", without(terms, "treasury"), "Invalid drop terms fields"],
        ["the terms of another currency", { ...terms, currency: "uatom" }, "Drop terms do not match the request"],
        ["a negative fee that is not the sentinel", { ...terms, collectionFee: "-2" }, "Invalid collection fee"],
        ["a sentinel written as a number", { ...terms, collectionFee: -1 }, "Invalid collection fee"],
        ["a negative rate that is not the sentinel", { ...terms, primaryFeeBPS: "-5" }, "Invalid primary fee bps"],
        ["a cap that is not set", { ...terms, maxPrimaryFeeBPS: "-1" }, "Invalid maximum primary fee bps"],
        ["a cap above the realm's", { ...terms, maxPrimaryFeeBPS: "501" }, "Inconsistent drop fee"],
        ["a fee above its cap", { ...terms, primaryFeeBPS: "300", maxPrimaryFeeBPS: "250" }, "Inconsistent drop fee"],
        ["a malformed treasury", { ...terms, treasury: "treasury" }, "Invalid treasury"],
        ["a treasury that is not text", { ...terms, treasury: null }, "Invalid treasury"],
    ])("rejects %s", async (_name, row, message) => {
        await expect(read(row)).rejects.toThrow(new RegExp(`^${message}$`))
    })

    it("reports unreadable terms as an error", async () => {
        queryEval.mockResolvedValueOnce(null)
        await expect(getDropTerms("ugnot")).rejects.toThrow("Could not read drop terms")
    })

    it.each(["", "u gnot", 'ugnot") + ("', "a".repeat(101)])("never sends the malformed currency %j to the chain", async (currency) => {
        await expect(getDropTerms(currency)).rejects.toThrow("Invalid currency")
        expect(queryEval).not.toHaveBeenCalled()
    })
})

describe("stage counters", () => {
    it("reads how many tokens an account minted in a stage", async () => {
        queryEval.mockResolvedValueOnce("(3 int64)")
        await expect(mintedBy("C1", 2, addr(4))).resolves.toBe(3n)
        expect(queryEval).toHaveBeenCalledWith(GNO_RPC_URL, NFT_DROPS_PATH, `MintedBy("C1", 2, "${addr(4)}")`, true)
        queryEval.mockResolvedValueOnce("(0 int64)\n")
        await expect(mintedBy("C1", 0, addr(4))).resolves.toBe(0n)
        queryEval.mockResolvedValueOnce("(9223372036854775807 int64)")
        await expect(mintedBy("C1", 0, addr(4))).resolves.toBe(9223372036854775807n)
    })

    it("reads whether a gate token has been used", async () => {
        queryEval.mockResolvedValueOnce("(true bool)")
        await expect(gateUsed("C1", 0, 12n)).resolves.toBe(true)
        expect(queryEval).toHaveBeenCalledWith(GNO_RPC_URL, NFT_DROPS_PATH, 'GateUsed("C1", 0, 12)', true)
        queryEval.mockResolvedValueOnce("(false bool)\n")
        await expect(gateUsed("C1", 0, 12n)).resolves.toBe(false)
    })

    it.each(["(-1 int64)", "(03 int64)", "(9223372036854775808 int64)", "(3 int)", '("3" string)', "(true bool)", "3", ""])("rejects the count %j", async (raw) => {
        queryEval.mockResolvedValueOnce(raw)
        await expect(mintedBy("C1", 0, addr(4))).rejects.toThrow(/^Invalid minted count$/)
    })

    it.each(["(1 bool)", "(TRUE bool)", '("true" string)', "(0 int64)", "true", ""])("rejects the flag %j", async (raw) => {
        queryEval.mockResolvedValueOnce(raw)
        await expect(gateUsed("C1", 0, 12n)).rejects.toThrow(/^Invalid gate token use$/)
    })

    it("reports an unreadable counter as an error, never as zero or unused", async () => {
        queryEval.mockResolvedValue(null)
        await expect(mintedBy("C1", 0, addr(4))).rejects.toThrow("Could not read minted count")
        await expect(gateUsed("C1", 0, 12n)).rejects.toThrow("Could not read gate token use")
    })

    it("never sends a malformed argument to the chain", async () => {
        await expect(mintedBy('C1", 0, "x") + ("', 0, addr(4))).rejects.toThrow("Invalid collection ID")
        await expect(mintedBy("C1", -1, addr(4))).rejects.toThrow("Invalid stage index")
        await expect(mintedBy("C1", 0.5, addr(4))).rejects.toThrow("Invalid stage index")
        await expect(mintedBy("C1", '0, "x") + (' as unknown as number, addr(4))).rejects.toThrow("Invalid stage index")
        await expect(mintedBy("C1", 0, `${addr(4)}") + ("`)).rejects.toThrow("Invalid minter")
        await expect(gateUsed("C01", 0, 12n)).rejects.toThrow("Invalid collection ID")
        await expect(gateUsed("C1", 10.5, 12n)).rejects.toThrow("Invalid stage index")
        await expect(gateUsed("C1", 0, -1n)).rejects.toThrow("Invalid gate token number")
        await expect(gateUsed("C1", 0, "12) + (" as unknown as bigint)).rejects.toThrow("Invalid gate token number")
        expect(queryEval).not.toHaveBeenCalled()
    })
})
