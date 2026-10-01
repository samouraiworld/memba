import { beforeEach, describe, expect, it, vi } from "vitest"

const reads = vi.hoisted(() => ({ queryEval: vi.fn() }))
vi.mock("../dao/shared", async (original) => ({ ...(await original<object>()), queryEval: reads.queryEval }))

import { buildCreateCollectionMsg, encodeRoyalties, isReservedSymbol, isUnspendable, percentToBPS, termsProblem, validBaseURI, type CollectionTerms } from "./create"
import { TOKEN_LAUNCHPAD_CONFIG_PATH } from "../tokenLaunchpadConfigClient"
import { NFT_DROPS_PATH } from "./drops"

const CREATOR = "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5"
const A = "g1c0j899h88nwyvnzvh5jagpq6fkkyuj76nld6t0"
const B = "g1e6gxg5tvc55mwsn7t7dymmlasratv7mkv0rap2"
const BASE = `ipfs://bafy${"b".repeat(55)}/`
const terms = (more: Partial<CollectionTerms> = {}): CollectionTerms => ({
    name: "Relevés", symbol: "REL", description: "Field drawings.", image: `ipfs://bafy${"i".repeat(55)}`, banner: "", website: "https://relev.es",
    mode: "open", revocable: false, maxSupply: 100n, metadataMode: "static", baseURI: BASE, royalties: [], ...more,
})

describe("collection terms", () => {
    it("takes terms the ledger takes", () => {
        expect(termsProblem(terms())).toBe("")
        expect(termsProblem(terms({ mode: "royalty_protected", royalties: [{ account: A, bps: 500n }, { account: B, bps: 500n }] }))).toBe("")
        expect(termsProblem(terms({ mode: "soulbound", revocable: true, maxSupply: 0n, metadataMode: "mutable", image: "", website: "" }))).toBe("")
        expect(termsProblem(terms({ name: "a".repeat(32), symbol: "ABCDEFGH12", description: "é".repeat(140) }))).toBe("")
    })

    it.each<[string, Partial<CollectionTerms>, RegExp]>([
        ["an empty name", { name: "" }, /^The name/],
        ["a name over 32 bytes", { name: "é".repeat(17) }, /^The name/],
        ["a name of 33 bytes", { name: "a".repeat(33) }, /^The name/],
        ["a name with markup", { name: "Bold *one*" }, /^The name/],
        ["a name with a backslash", { name: "a\\b" }, /^The name/],
        ["a name with a space at an end", { name: "Relevés " }, /^The name/],
        ["a name with a control character", { name: "a\u0007b" }, /^The name/],
        ["a name with a non-breaking space", { name: "a b" }, /^The name/],
        ["a lowercase symbol", { symbol: "rel" }, /^The symbol/],
        ["a symbol over 10 characters", { symbol: "ABCDEFGHIJK" }, /^The symbol/],
        ["a description over 280 bytes", { description: "é".repeat(141) }, /^The description/],
        ["a description with brackets", { description: "see [here]" }, /^The description/],
        ["an http image", { image: "http://x.org/a.png" }, /^The image/],
        ["an image with a quote", { image: "https://x.org/a'.png" }, /^The image/],
        ["an image over 200 characters", { image: `https://x.org/${"a".repeat(187)}` }, /^The image/],
        ["a banner with a space", { banner: "https://x.org/a b.png" }, /^The banner/],
        ["an ipfs website", { website: "ipfs://bafyabc" }, /^The website/],
        ["a revocable transferable collection", { revocable: true }, /revocable/],
        ["a negative supply", { maxSupply: -1n }, /maximum supply/],
        ["an https base URI", { baseURI: "https://x.org/meta/" }, /^The base URI/],
        ["a base URI that is not a folder", { baseURI: `ipfs://bafy${"b".repeat(55)}` }, /^The base URI/],
        ["a base URI with a dot segment", { baseURI: `ipfs://bafy${"b".repeat(55)}/../` }, /^The base URI/],
        ["a base URI with a query", { baseURI: `ipfs://bafy${"b".repeat(55)}/?a/` }, /^The base URI/],
        ["a royalty-protected collection without royalties", { mode: "royalty_protected" }, /needs at least one royalty receiver/],
        ["royalties on soulbound tokens", { mode: "soulbound", royalties: [{ account: A, bps: 100n }] }, /take no royalties/],
        ["a receiver in capitals", { royalties: [{ account: A.toUpperCase(), bps: 100n }] }, /not an address/],
        ["a receiver twice", { royalties: [{ account: A, bps: 100n }, { account: A, bps: 100n }] }, /listed twice/],
        ["a zero share", { royalties: [{ account: A, bps: 0n }] }, /above 0%/],
        ["royalties over 10%", { royalties: [{ account: A, bps: 600n }, { account: B, bps: 401n }] }, /at most 10%/],
        ["eleven receivers", { royalties: Array.from({ length: 11 }, () => ({ account: A, bps: 1n })) }, /At most 10 royalty receivers/],
    ])("refuses %s", (_, more, problem) => {
        expect(termsProblem(terms(more))).toMatch(problem)
    })

    it("reads a base URI as the ledger does", () => {
        expect(validBaseURI(BASE)).toBe(true)
        expect(validBaseURI(`${BASE}meta/`)).toBe(true)
        for (const bad of ["ipfs://", "ipfs:///x/", "ipfs://x/%20/", "ipfs://x/#/", "ipfs://x/.hidden/", "ipfs://x y/"]) expect(validBaseURI(bad)).toBe(false)
    })

    it("writes royalties in the one order the ledger accepts", () => {
        expect(encodeRoyalties([{ account: B, bps: 250n }, { account: A, bps: 100n }])).toBe(`${A}:100;${B}:250`)
        expect(encodeRoyalties([])).toBe("")
    })

    it("reads a royalty share as a percentage with at most two decimals", () => {
        expect(percentToBPS("2.5")).toBe(250n)
        expect(percentToBPS(" 10 ")).toBe(1000n)
        expect(percentToBPS("0.01")).toBe(1n)
        for (const bad of ["", "2,5", "2.555", "100", "-1", "1e2"]) expect(percentToBPS(bad)).toBeNull()
    })
})

describe("creation call", () => {
    it("sends every term in the realm's order, with exactly the fee attached", () => {
        expect(buildCreateCollectionMsg(CREATOR, terms({ royalties: [{ account: B, bps: 250n }, { account: A, bps: 100n }] }), 1_000_000n)).toEqual({
            type: "vm/MsgCall",
            value: {
                caller: CREATOR, send: "1000000ugnot", pkg_path: NFT_DROPS_PATH, func: "CreateCollection",
                args: ["Relevés", "REL", "Field drawings.", `ipfs://bafy${"i".repeat(55)}`, "", "https://relev.es", "open", "false", "100", "static", BASE, "", "", "", `${A}:100;${B}:250`, "ugnot", "1000000"],
                max_deposit: "2000000ugnot",
            },
        })
    })

    it("attaches nothing when creation is free, and refuses terms the ledger would refuse", () => {
        expect(buildCreateCollectionMsg(CREATOR, terms(), 0n).value.send).toBe("")
        expect(() => buildCreateCollectionMsg(CREATOR, terms({ symbol: "x" }), 0n)).toThrow(/^The symbol/)
        expect(() => buildCreateCollectionMsg(CREATOR, terms(), -1n)).toThrow("Invalid collection fee")
        expect(() => buildCreateCollectionMsg(CREATOR.toUpperCase(), terms(), 0n)).toThrow("Invalid account")
    })
})

describe("config reads", () => {
    beforeEach(() => reads.queryEval.mockReset())

    it("asks config whether a symbol is reserved and whether a receiver can be paid", async () => {
        reads.queryEval.mockResolvedValueOnce("(true bool)").mockResolvedValueOnce("(false bool)")
        expect(await isReservedSymbol("GNOT")).toBe(true)
        expect(await isUnspendable(A)).toBe(false)
        expect(reads.queryEval.mock.calls.map((call) => call.slice(1, 3))).toEqual([[TOKEN_LAUNCHPAD_CONFIG_PATH, `IsReserved("GNOT")`], [TOKEN_LAUNCHPAD_CONFIG_PATH, `IsUnspendable("${A}")`]])
    })

    it("puts nothing unchecked into the query", async () => {
        await expect(isReservedSymbol(`A")`)).rejects.toThrow("Invalid symbol")
        await expect(isUnspendable(`${A}")`)).rejects.toThrow("Invalid account")
        expect(reads.queryEval).not.toHaveBeenCalled()
    })
})
