import { beforeEach, describe, expect, it, vi } from "vitest"
import { GNO_RPC_URL } from "../config"
import { bech32Encode } from "../dao/realmAddress"
import { AbciQueryError } from "../rpcFallback"
import { NFT_LEDGER_PATH, getApproval, getCapabilities, getCollection, getToken, listHoldings, listNewestCollections, listTokens } from "./ledger"
import { ReadError, RealmRefusedError } from "./read"

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
    it("reads the realm's own answer", async () => {
        queryEval.mockImplementation(async (_rpc: string, _path: string, expr: string) => expr === "Count()" ? "(2 int64)" : quoted(REALM_LIST))
        await expect(listNewestCollections()).resolves.toEqual({
            total: 2n,
            collections: [
                { id: "C2", creator: CREATOR, name: "Sample", symbol: "SAMPLE", image: "ipfs://image", mode: "soulbound", maxSupply: 3n, sealed: false, minted: 0n },
                { id: "C1", creator: CREATOR, name: "Sample", symbol: "SAMPLE", image: "ipfs://image", mode: "open", maxSupply: 0n, sealed: false, minted: 0n },
            ],
        })
        expect(queryEval).toHaveBeenCalledWith(GNO_RPC_URL, NFT_LEDGER_PATH, "Count()", true)
        expect(queryEval).toHaveBeenCalledWith(GNO_RPC_URL, NFT_LEDGER_PATH, "ListCollectionsJSON(0, 20)", true)
    })

    it("reads an empty ledger as empty, without listing", async () => {
        ledger(0)
        await expect(listNewestCollections()).resolves.toEqual({ total: 0n, collections: [] })
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
        const newest = await listNewestCollections(size)
        expect(newest.total).toBe(BigInt(total))
        expect(ids(newest.collections)).toEqual(expected)
        const lists = queryEval.mock.calls.map((call) => call[2]).filter((expr: string) => expr !== "Count()")
        expect(lists).toEqual(pages.map((index) => `ListCollectionsJSON(${index}, ${size})`))
    })

    it("leaves out a collection created between the count and the list", async () => {
        ledger(3, (index) => index === 0 ? [row(1), row(2), row(3), row(4)] : [])
        expect(ids((await listNewestCollections(5)).collections)).toEqual(["C3", "C2", "C1"])
    })

    it.each([
        ["a gap in the IDs", (index: number) => index === 0 ? [row(1), row(3), row(4)] : []],
        ["rows out of order", (index: number) => index === 0 ? [row(2), row(1), row(3)] : []],
    ])("refuses %s", async (_name, rows) => {
        ledger(3, rows)
        await expect(listNewestCollections(5)).rejects.toThrow(/^Inconsistent collection list$/)
    })

    it("reads fewer rows than counted as a read to try again, never as the whole list", async () => {
        ledger(3, (index) => index === 0 ? [row(1), row(2)] : [])
        const short = listNewestCollections(5)
        await expect(short).rejects.toBeInstanceOf(ReadError)
        await expect(short).rejects.toThrow("Could not read every collection counted")
        // The largest count an int64 holds is a count; the pages behind it are short here.
        ledger(0, () => [])
        queryEval.mockResolvedValueOnce("(9223372036854775807 int64)")
        await expect(listNewestCollections()).rejects.toBeInstanceOf(ReadError)
    })

    it("reports a read that reached no answer as retryable, never as an empty list", async () => {
        queryEval.mockResolvedValueOnce(null)
        const failed = listNewestCollections()
        await expect(failed).rejects.toBeInstanceOf(ReadError)
        await expect(failed).rejects.toThrow("Could not read collection count")
        queryEval.mockRejectedValueOnce(new Error("abci error"))
        await expect(listNewestCollections()).rejects.toBeInstanceOf(ReadError)
    })

    it.each(["12", "(-1 int64)", "(01 int64)", "(9223372036854775808 int64)", "(9223372036854775808999 int64)", "(3 uint64)"])("refuses the count %s", async (count) => {
        queryEval.mockResolvedValueOnce(count)
        const failed = listNewestCollections()
        await expect(failed).rejects.toThrow("Invalid collection count")
        await expect(failed).rejects.not.toBeInstanceOf(ReadError)
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
        const failed = listNewestCollections()
        await expect(failed).rejects.toThrow(new RegExp(`^${message}$`))
        await expect(failed).rejects.not.toBeInstanceOf(ReadError)
    })

    it("accepts what the realm accepts at its limits", async () => {
        ledger(1, () => [row(1, { name: "é".repeat(16), symbol: "ABCDEFGHIJ", image: `ipfs://${"a".repeat(193)}` })])
        await expect(listNewestCollections()).resolves.toMatchObject({ total: 1n })
    })

    it.each([0, 51, 1.5, -1])("never asks the chain for %d collections", async (size) => {
        await expect(listNewestCollections(size)).rejects.toThrow("Invalid collection page")
        expect(queryEval).not.toHaveBeenCalled()
    })
})

/** Sixteen addresses with valid checksums, in strictly ascending order. */
const ADDRESSES = Array.from({ length: 16 }, (_, n) => bech32Encode("g", new Uint8Array(20).fill(n))).sort()
const addr = (n: number) => ADDRESSES[n]
const HASH = "a".repeat(64)
const answer = (value: unknown) => queryEval.mockResolvedValueOnce(quoted(JSON.stringify(value)))

/**
 * What the ledger realm itself printed, with its unit test helpers (gno test at
 * feat/t4-nft-origin 1f424c6), for `CollectionJSON` of a static open
 * collection holding one token, an unrevealed reveal collection holding one,
 * and a royalty-protected one; `TokenJSON` of token 1 in the first two; and
 * `CapabilitiesJSON` of the static, the royalty-protected and a revocable
 * soulbound collection. Copied, not built from this reader's model.
 */
const REALM_STATIC = `{"id":"C1","grc721Id":"gno.land/r/samcrew/launchpad/nft/v1.SAMPLE.0000001","issuer":"g146wfcjtz9flxkkelzl5kva7sfk78jnannnpsyp","creator":"g1den8gttrwfjkzar0wf047h6lta047h6l69tljg","originator":"g1den8gttrwfjkzar0wf047h6lta047h6l69tljg","pendingCreator":"","name":"Sample","symbol":"SAMPLE","description":"A sample.","image":"ipfs://image","banner":"","website":"https://example.org","mode":"open","revocable":false,"maxSupply":"0","sealed":false,"minted":"1","totalSupply":"1","profileFrozen":false,"metadataMode":"static","metadataFrozen":true,"metadataRevision":"0","baseURI":"ipfs://sample/","placeholderURI":"","baseURICommitment":"","committer":"","provenanceHash":"","traitsRoot":"","royaltyBPS":"0","royalties":[],"markets":[]}`
const REALM_REVEAL = `{"id":"C2","grc721Id":"gno.land/r/samcrew/launchpad/nft/v1.SAMPLE.0000002","issuer":"g146wfcjtz9flxkkelzl5kva7sfk78jnannnpsyp","creator":"g1den8gttrwfjkzar0wf047h6lta047h6l69tljg","originator":"g1den8gttrwfjkzar0wf047h6lta047h6l69tljg","pendingCreator":"","name":"Sample","symbol":"SAMPLE","description":"","image":"","banner":"","website":"","mode":"open","revocable":false,"maxSupply":"0","sealed":false,"minted":"1","totalSupply":"1","profileFrozen":false,"metadataMode":"reveal","metadataFrozen":false,"metadataRevision":"0","baseURI":"","placeholderURI":"ipfs://bafyplaceholder/hidden.json","baseURICommitment":"7bd2a19fca194f9cd3b8ee9e4261e34abbcd893a41c8d0e4c069cb6d89b80f19","committer":"g1den8gttrwfjkzar0wf047h6lta047h6l69tljg","provenanceHash":"abababababababababababababababababababababababababababababababab","traitsRoot":"","royaltyBPS":"0","royalties":[],"markets":[]}`
const REALM_PROTECTED = `{"id":"C3","grc721Id":"gno.land/r/samcrew/launchpad/nft/v1.SAMPLE.0000003","issuer":"g146wfcjtz9flxkkelzl5kva7sfk78jnannnpsyp","creator":"g1den8gttrwfjkzar0wf047h6lta047h6l69tljg","originator":"g1den8gttrwfjkzar0wf047h6lta047h6l69tljg","pendingCreator":"","name":"Sample","symbol":"SAMPLE","description":"A sample.","image":"ipfs://image","banner":"","website":"https://example.org","mode":"royalty_protected","revocable":false,"maxSupply":"10","sealed":false,"minted":"0","totalSupply":"0","profileFrozen":false,"metadataMode":"static","metadataFrozen":true,"metadataRevision":"0","baseURI":"ipfs://sample/","placeholderURI":"","baseURICommitment":"","committer":"","provenanceHash":"","traitsRoot":"","royaltyBPS":"500","royalties":[{"account":"g1den8gttpwf6xjum5ta047h6lta047h6lhnz2nk","bps":"500"}],"markets":["g1nn54k5fmly8agexe3ll4t6clqmcefsn7nr9ee3"]}`
const REALM_TOKEN = `{"collection":"C1","number":"1","owner":"g1den8gttgdakxgetjta047h6lta047h6l30gcaz","status":"active","uri":"ipfs://sample/1.json"}`
const REALM_REVEAL_TOKEN = `{"collection":"C2","number":"1","owner":"g1den8gttgdakxgetjta047h6lta047h6l30gcaz","status":"active","uri":"ipfs://bafyplaceholder/hidden.json"}`
const REALM_CAPABILITIES_STATIC = `{"schema":"launchpad-nft-capabilities/v1","collection":"C1","standard":"grc721","mode":"open","holderTransfer":true,"marketSale":true,"markets":[],"holderBurn":true,"creatorRevoke":false,"maxSupply":"0","metadataMode":"static","metadataFrozen":true,"traitsCommitted":false,"royaltyBPS":"0","royaltyEnforcement":"none"}`
const REALM_CAPABILITIES_PROTECTED = `{"schema":"launchpad-nft-capabilities/v1","collection":"C3","standard":"grc721","mode":"royalty_protected","holderTransfer":false,"marketSale":true,"markets":["g1nn54k5fmly8agexe3ll4t6clqmcefsn7nr9ee3"],"holderBurn":true,"creatorRevoke":false,"maxSupply":"10","metadataMode":"static","metadataFrozen":true,"traitsCommitted":false,"royaltyBPS":"500","royaltyEnforcement":"listed_markets"}`
const REALM_CAPABILITIES_SOULBOUND = `{"schema":"launchpad-nft-capabilities/v1","collection":"C4","standard":"grc721","mode":"soulbound","holderTransfer":false,"marketSale":false,"markets":[],"holderBurn":true,"creatorRevoke":true,"maxSupply":"3","metadataMode":"static","metadataFrozen":true,"traitsCommitted":false,"royaltyBPS":"0","royaltyEnforcement":"none"}`
const MARKET = "g1nn54k5fmly8agexe3ll4t6clqmcefsn7nr9ee3"
const HOLDER = "g1den8gttgdakxgetjta047h6lta047h6l30gcaz"

const open = {
    id: "C1", grc721Id: "gno.land/r/samcrew/launchpad/nft/v1.SAMPLE.0000001", issuer: addr(15), creator: addr(0), originator: addr(0), pendingCreator: "",
    name: "Sample", symbol: "SAMPLE", description: "A sample.", image: "ipfs://image", banner: "", website: "https://example.org",
    mode: "open", revocable: false, maxSupply: "0", sealed: false, minted: "2", totalSupply: "1", profileFrozen: false,
    metadataMode: "static", metadataFrozen: true,
    metadataRevision: "0", baseURI: "ipfs://sample/", placeholderURI: "", baseURICommitment: "", committer: "", provenanceHash: "", traitsRoot: "",
    royaltyBPS: "251", royalties: [{ account: addr(1), bps: "250" }, { account: addr(2), bps: "1" }], markets: [] as string[],
}
const soulbound = { ...open, mode: "soulbound", revocable: true, royaltyBPS: "0", royalties: [] }
const royaltyProtected = { ...open, mode: "royalty_protected", markets: [addr(3)] }
const mutable = { ...open, metadataMode: "mutable", metadataFrozen: false, metadataRevision: "3" }
const hidden = { ...open, metadataMode: "reveal", metadataFrozen: false, baseURI: "", placeholderURI: "ipfs://placeholder.json", baseURICommitment: HASH, committer: addr(0), provenanceHash: "b".repeat(64) }
const revealed = { ...hidden, baseURI: "ipfs://revealed/", metadataFrozen: true, metadataRevision: "1" }

const token = { collection: "C1", number: "1", owner: addr(4), status: "active", uri: "ipfs://sample/1.json" }
const capabilities = {
    schema: "launchpad-nft-capabilities/v1", collection: "C1", standard: "grc721", mode: "open", holderTransfer: true, marketSale: true,
    markets: [] as string[], holderBurn: true, creatorRevoke: false, maxSupply: "7", metadataMode: "static", metadataFrozen: true,
    traitsCommitted: false, royaltyBPS: "0", royaltyEnforcement: "none",
}


const collection = (row: unknown) => { answer(row); return getCollection("C1") }

beforeEach(() => { queryEval.mockReset() })

describe("collection", () => {
    it("reads the realm's own answer for a static, a reveal and a royalty-protected collection", async () => {
        const creator = "g1den8gttrwfjkzar0wf047h6lta047h6l69tljg"
        const issuer = "g146wfcjtz9flxkkelzl5kva7sfk78jnannnpsyp"
        const record = {
            id: "C1", grc721Id: "gno.land/r/samcrew/launchpad/nft/v1.SAMPLE.0000001", issuer, creator, originator: creator, pendingCreator: "",
            name: "Sample", symbol: "SAMPLE", description: "A sample.", image: "ipfs://image", banner: "", website: "https://example.org",
            mode: "open", revocable: false, maxSupply: 0n, sealed: false, minted: 1n, totalSupply: 1n, profileFrozen: false,
            metadataMode: "static", metadataFrozen: true, metadataRevision: 0n, baseURI: "ipfs://sample/", placeholderURI: "",
            baseURICommitment: "", committer: "", provenanceHash: "", traitsRoot: "", royaltyBPS: 0n, royalties: [], markets: [],
        }
        queryEval.mockResolvedValueOnce(quoted(REALM_STATIC))
        await expect(getCollection("C1")).resolves.toEqual(record)
        queryEval.mockResolvedValueOnce(quoted(REALM_REVEAL))
        await expect(getCollection("C2")).resolves.toEqual({
            ...record, id: "C2", grc721Id: "gno.land/r/samcrew/launchpad/nft/v1.SAMPLE.0000002", description: "", image: "", website: "",
            metadataMode: "reveal", metadataFrozen: false, baseURI: "", placeholderURI: "ipfs://bafyplaceholder/hidden.json",
            baseURICommitment: "7bd2a19fca194f9cd3b8ee9e4261e34abbcd893a41c8d0e4c069cb6d89b80f19", committer: creator, provenanceHash: "ab".repeat(32),
        })
        queryEval.mockResolvedValueOnce(quoted(REALM_PROTECTED))
        await expect(getCollection("C3")).resolves.toEqual({
            ...record, id: "C3", grc721Id: "gno.land/r/samcrew/launchpad/nft/v1.SAMPLE.0000003", mode: "royalty_protected", maxSupply: 10n,
            minted: 0n, totalSupply: 0n, royaltyBPS: 500n, royalties: [{ account: "g1den8gttpwf6xjum5ta047h6lta047h6lhnz2nk", bps: 500n }], markets: [MARKET],
        })
    })

    it("reads an open, static collection with every field typed", async () => {
        await expect(collection(open)).resolves.toEqual({
            ...open, maxSupply: 0n, minted: 2n, totalSupply: 1n, metadataRevision: 0n, royaltyBPS: 251n,
            royalties: [{ account: addr(1), bps: 250n }, { account: addr(2), bps: 1n }],
        })
        expect(queryEval).toHaveBeenCalledWith(GNO_RPC_URL, NFT_LEDGER_PATH, 'CollectionJSON("C1")', true)
    })

    it.each([
        ["a revocable soulbound collection without royalties", soulbound],
        ["a soulbound collection that cannot be revoked", { ...soulbound, revocable: false }],
        ["a royalty-protected collection with its markets", { ...royaltyProtected, markets: [addr(3), addr(4), addr(5), addr(6), addr(7)] }],
        ["a mutable collection, frozen or not", mutable],
        ["a frozen mutable collection", { ...mutable, metadataFrozen: true }],
        ["a reveal collection before its reveal", hidden],
        ["a reveal collection after its reveal", revealed],
        ["a reveal collection whose creator is no longer its committer", { ...hidden, committer: addr(8) }],
        ["a capped collection minted out", { ...open, maxSupply: "2" }],
        ["a sealed collection", { ...open, sealed: true }],
        ["a creator handoff in progress", { ...open, pendingCreator: addr(9) }],
        ["a collection whose role moved from its originator", { ...open, creator: addr(9) }],
        ["a traits root on frozen metadata", { ...open, traitsRoot: HASH }],
        ["ten royalty receivers summing to the cap", { ...open, royaltyBPS: "1000", royalties: Array.from({ length: 10 }, (_, n) => ({ account: addr(n), bps: "100" })) }],
        ["a base URI, name, symbol, image and banner at the realm's limits",
            { ...open, baseURI: `ipfs://${"a".repeat(192)}/`, name: "é".repeat(16), symbol: "ABCDEFGHIJ", image: `ipfs://${"a".repeat(193)}`, banner: "https://example.org/b.png" }],
    ])("accepts %s", async (_name, row) => {
        await expect(collection(row)).resolves.toMatchObject({ id: "C1", mode: row.mode, metadataMode: row.metadataMode })
    })

    it("keeps int64 values exact", async () => {
        await expect(collection({ ...open, maxSupply: "9223372036854775807" })).resolves.toMatchObject({ maxSupply: 9223372036854775807n })
    })

    it.each([
        ["a renamed field", { ...without(open, "banner"), bannerURI: "" }, "Invalid collection fields"],
        ["an unknown extra field", { ...open, tradable: true }, "Invalid collection fields"],
        ["a missing field", without(open, "traitsRoot"), "Invalid collection fields"],
        ["a list where a collection is expected", [open], "Invalid collection"],
        ["text where a collection is expected", "C1", "Invalid collection"],
        ["a number where a decimal string is expected", { ...open, minted: 2 }, "Invalid minted count"],
        ["a decimal with a leading zero", { ...open, minted: "02" }, "Invalid minted count"],
        ["a negative decimal", { ...open, totalSupply: "-1" }, "Invalid total supply"],
        ["a string where a boolean is expected", { ...open, profileFrozen: "false" }, "Invalid profile frozen"],
        ["a number where text is expected", { ...open, name: 7 }, "Invalid name"],
        ["a creator address of the wrong length", { ...open, creator: "g1creator" }, "Invalid creator"],
        ["a creator address outside the bech32 alphabet", { ...open, creator: `g1${"b".repeat(38)}` }, "Invalid creator"],
        ["a malformed collection ID", { ...open, id: "C01" }, "Invalid collection ID"],
        ["a malformed issuer address", { ...open, issuer: "gno.land/r/samcrew/launchpad" }, "Invalid issuer"],
        ["an issuer left empty", { ...open, issuer: "" }, "Invalid issuer"],
        ["a malformed pending creator", { ...open, pendingCreator: "g1pending" }, "Invalid pending creator"],
        ["a pending creator that is not text", { ...open, pendingCreator: null }, "Invalid pending creator"],
        ["a sealed flag that is not a boolean", { ...open, sealed: "true" }, "Invalid sealed"],
        ["a record without its issuer, pending creator and sealed flag", without(without(without(open, "issuer"), "pendingCreator"), "sealed"), "Invalid collection fields"],
        ["an unknown mode", { ...open, mode: "tradable" }, "Invalid collection mode"],
        ["a revocable collection that is not soulbound", { ...open, revocable: true }, "Inconsistent collection mode"],
        ["more minted than the maximum supply", { ...open, maxSupply: "1" }, "Inconsistent collection supply"],
        ["more tokens in existence than were minted", { ...open, totalSupply: "3" }, "Inconsistent collection supply"],
        ["an unknown metadata mode", { ...open, metadataMode: "hidden" }, "Invalid metadata mode"],
        ["static metadata that is not frozen", { ...open, metadataFrozen: false }, "Inconsistent collection metadata"],
        ["static metadata without a base URI", { ...open, baseURI: "" }, "Inconsistent collection metadata"],
        ["static metadata on a server", { ...open, baseURI: "https://example.org/meta/" }, "Inconsistent collection metadata"],
        ...["ipfs:///", "ipfs://../", "ipfs://bafyx/./", "ipfs://bafyx/../../ipns/k51x/", "ipfs://bafyx/%2e%2e/ipns/k51x/",
            "ipfs://bafyx/?a=/", "ipfs://bafyx/#/"].map((baseURI): [string, object, string] =>
            [`a base URI a gateway could resolve elsewhere: ${baseURI}`, { ...open, baseURI }, "Inconsistent collection metadata"]),
        ["a placeholder a gateway could resolve elsewhere", { ...hidden, placeholderURI: "ipfs://bafyx/../x.json" }, "Inconsistent collection metadata"],
        ["a base URI that is not a directory", { ...open, baseURI: "ipfs://sample" }, "Inconsistent collection metadata"],
        ["a base URI over 200 bytes", { ...open, baseURI: `ipfs://${"a".repeat(193)}/` }, "Inconsistent collection metadata"],
        ["a base URI with a quote", { ...open, baseURI: 'ipfs://sam"ple/' }, "Inconsistent collection metadata"],
        ["a revealed base URI that is not a directory", { ...revealed, baseURI: "ipfs://revealed" }, "Inconsistent collection metadata"],
        ["a placeholder that is not a JSON file", { ...hidden, placeholderURI: "ipfs://placeholder/" }, "Inconsistent collection metadata"],
        ["a placeholder with a quote", { ...hidden, placeholderURI: 'ipfs://place"holder.json' }, "Inconsistent collection metadata"],
        ["a reveal commitment of all zeros", { ...hidden, baseURICommitment: "0".repeat(64) }, "Inconsistent collection metadata"],
        ["an empty name", { ...open, name: "" }, "Invalid name"],
        ["a name with markup", { ...open, name: "**Admin**" }, "Invalid name"],
        ["a name over 32 bytes", { ...open, name: "é".repeat(17) }, "Invalid name"],
        ["a lowercase symbol", { ...open, symbol: "sample" }, "Invalid symbol"],
        ["an image on another scheme", { ...open, image: "http://example.org/a.png" }, "Invalid image"],
        ["a banner with a quote", { ...open, banner: 'ipfs://ban"ner' }, "Invalid banner"],
        ["a banner over 200 bytes", { ...open, banner: `ipfs://${"a".repeat(194)}` }, "Invalid banner"],
        ["a malformed originator", { ...open, originator: "g1origin" }, "Invalid originator"],
        ["a record without its originator", without(open, "originator"), "Invalid collection fields"],
        ["static metadata with a placeholder", { ...open, placeholderURI: "ipfs://placeholder.json" }, "Inconsistent collection metadata"],
        ["static metadata with a base URI commitment", { ...open, baseURICommitment: HASH }, "Inconsistent collection metadata"],
        ["static metadata with a committer", { ...open, committer: addr(0) }, "Inconsistent collection metadata"],
        ["static metadata with a provenance hash", { ...open, provenanceHash: HASH }, "Inconsistent collection metadata"],
        ["static metadata with a revision", { ...open, metadataRevision: "1" }, "Inconsistent collection metadata"],
        ["mutable metadata without a base URI", { ...mutable, baseURI: "" }, "Inconsistent collection metadata"],
        ["mutable metadata on a server", { ...mutable, baseURI: "https://example.org/meta/" }, "Inconsistent collection metadata"],
        ["mutable metadata with a placeholder", { ...mutable, placeholderURI: "ipfs://placeholder.json" }, "Inconsistent collection metadata"],
        ["mutable metadata with a base URI commitment", { ...mutable, baseURICommitment: HASH }, "Inconsistent collection metadata"],
        ["mutable metadata with a committer", { ...mutable, committer: addr(0) }, "Inconsistent collection metadata"],
        ["mutable metadata with a provenance hash", { ...mutable, provenanceHash: HASH }, "Inconsistent collection metadata"],
        ["a reveal placeholder that is not on IPFS", { ...hidden, placeholderURI: "https://example.org/placeholder.json" }, "Inconsistent collection metadata"],
        ["a revealed base URI that is not on IPFS", { ...revealed, baseURI: "https://example.org/revealed/" }, "Inconsistent collection metadata"],
        ["a reveal commitment that is not lowercase hex", { ...hidden, baseURICommitment: "A".repeat(64) }, "Inconsistent collection metadata"],
        ["a reveal collection without a provenance hash", { ...hidden, provenanceHash: "" }, "Inconsistent collection metadata"],
        ["a reveal collection without a committer", { ...hidden, committer: "" }, "Invalid committer"],
        ["a revealed collection without a committer", { ...revealed, committer: "" }, "Invalid committer"],
        ["a malformed committer", { ...hidden, committer: "g1committer" }, "Invalid committer"],
        ["a committer that is not text", { ...open, committer: null }, "Invalid committer"],
        ["a record without its committer", without(open, "committer"), "Invalid collection fields"],
        ["an unrevealed collection already frozen", { ...hidden, metadataFrozen: true }, "Inconsistent collection metadata"],
        ["an unrevealed collection with a revision", { ...hidden, metadataRevision: "1" }, "Inconsistent collection metadata"],
        ["a revealed collection that is not frozen", { ...revealed, metadataFrozen: false }, "Inconsistent collection metadata"],
        ["a revealed collection without its revision", { ...revealed, metadataRevision: "0" }, "Inconsistent collection metadata"],
        ["a revealed collection revealed twice", { ...revealed, metadataRevision: "2" }, "Inconsistent collection metadata"],
        ["a traits root that is not a hash", { ...open, traitsRoot: "root" }, "Inconsistent traits root"],
        ["a traits root on metadata that is not frozen", { ...mutable, traitsRoot: HASH }, "Inconsistent traits root"],
        ["royalties that are not a list", { ...open, royalties: {} }, "Invalid royalties"],
        ["a royalty receiver with an unknown field", { ...open, royalties: [{ account: addr(1), bps: "251", label: "" }] }, "Invalid royalty receiver fields"],
        ["a malformed royalty account", { ...open, royalties: [{ account: "g1receiver", bps: "251" }] }, "Invalid royalty account"],
        ["more than ten royalty receivers", { ...open, royaltyBPS: "11", royalties: Array.from({ length: 11 }, (_, n) => ({ account: addr(n), bps: "1" })) }, "Inconsistent royalty terms"],
        ["royalty receivers out of order", { ...open, royalties: [{ account: addr(2), bps: "250" }, { account: addr(1), bps: "1" }] }, "Inconsistent royalty terms"],
        ["a royalty receiver listed twice", { ...open, royalties: [{ account: addr(1), bps: "250" }, { account: addr(1), bps: "1" }] }, "Inconsistent royalty terms"],
        ["a royalty receiver with no share", { ...open, royaltyBPS: "250", royalties: [{ account: addr(1), bps: "250" }, { account: addr(2), bps: "0" }] }, "Inconsistent royalty terms"],
        ["royalty shares that do not sum to the total", { ...open, royaltyBPS: "250" }, "Inconsistent royalty terms"],
        ["a royalty above ten percent", { ...open, royaltyBPS: "1001", royalties: [{ account: addr(1), bps: "1001" }] }, "Inconsistent royalty terms"],
        ["a soulbound collection with royalties", { ...soulbound, royaltyBPS: "251", royalties: open.royalties }, "Inconsistent royalty terms"],
        ["a royalty-protected collection without royalties", { ...royaltyProtected, royaltyBPS: "0", royalties: [] }, "Inconsistent royalty terms"],
        ["markets that are not a list", { ...open, markets: "" }, "Invalid markets"],
        ["a malformed market address", { ...royaltyProtected, markets: ["market"] }, "Invalid market"],
        ["a royalty-protected collection without a market", { ...royaltyProtected, markets: [] }, "Inconsistent collection markets"],
        ["a royalty-protected collection with six markets", { ...royaltyProtected, markets: [3, 4, 5, 6, 7, 8].map(addr) }, "Inconsistent collection markets"],
        ["an open collection naming a market", { ...open, markets: [addr(3)] }, "Inconsistent collection markets"],
        ["a soulbound collection naming a market", { ...soulbound, markets: [addr(3)] }, "Inconsistent collection markets"],
    ])("rejects %s", async (_name, row, message) => {
        await expect(collection(row)).rejects.toThrow(new RegExp(`^${message}$`))
    })

    it("reports an unreadable answer as retryable and an undecodable one as unusable", async () => {
        queryEval.mockResolvedValueOnce(null)
        const unread = getCollection("C1")
        await expect(unread).rejects.toThrow("Could not read collection")
        await expect(unread).rejects.toBeInstanceOf(ReadError)
        queryEval.mockRejectedValueOnce(new Error("abci error"))
        await expect(getCollection("C1")).rejects.toBeInstanceOf(ReadError)
        queryEval.mockResolvedValueOnce("not a qeval answer")
        const undecodable = getCollection("C1")
        await expect(undecodable).rejects.toThrow(/^Invalid collection$/)
        await expect(undecodable).rejects.not.toBeInstanceOf(ReadError)
    })

    it("reports what the realm refuses to read as refused, never as a read to retry", async () => {
        // The ledger panics on an unknown collection, on token 0 and on the approval of a retired token.
        const refuse = () => queryEval.mockRejectedValueOnce(new AbciQueryError("vm/qeval", "unknown collection"))
        for (const read of [() => getCollection("C9"), () => getToken("C1", 0n), () => getApproval("C1", 2n, addr(5)), () => getCapabilities("C9")]) {
            refuse()
            const refused = read()
            await expect(refused).rejects.toBeInstanceOf(RealmRefusedError)
            await expect(refused).rejects.not.toBeInstanceOf(ReadError)
        }
    })

    it("rejects an answer for another collection", async () => {
        answer(open)
        await expect(getCollection("C2")).rejects.toThrow("Collection does not match the request")
    })

    it.each(["", "C0", "C01", "c1", "1", 'C1")+("'])("never sends the malformed ID %j to the chain", async (id) => {
        await expect(getCollection(id)).rejects.toThrow("Invalid collection ID")
        await expect(getToken(id, 1n)).rejects.toThrow("Invalid collection ID")
        await expect(listTokens(id)).rejects.toThrow("Invalid collection ID")
        await expect(getApproval(id, 1n, addr(5))).rejects.toThrow("Invalid collection ID")
        await expect(getCapabilities(id)).rejects.toThrow("Invalid collection ID")
        expect(queryEval).not.toHaveBeenCalled()
    })
})


describe("token", () => {
    const read = (row: unknown) => { answer(row); return getToken("C1", 1n) }

    it("reads the realm's own answer for a minted token, its placeholder included before a reveal", async () => {
        queryEval.mockResolvedValueOnce(quoted(REALM_TOKEN))
        await expect(getToken("C1", 1n)).resolves.toEqual({ collection: "C1", number: 1n, owner: HOLDER, status: "active", uri: "ipfs://sample/1.json" })
        queryEval.mockResolvedValueOnce(quoted(REALM_REVEAL_TOKEN))
        await expect(getToken("C2", 1n)).resolves.toMatchObject({ collection: "C2", owner: HOLDER, uri: "ipfs://bafyplaceholder/hidden.json" })
    })

    it("reads an active token and one that no longer has an owner", async () => {
        await expect(read(token)).resolves.toEqual({ ...token, number: 1n })
        expect(queryEval).toHaveBeenCalledWith(GNO_RPC_URL, NFT_LEDGER_PATH, 'TokenJSON("C1", 1)', true)
        await expect(read({ ...token, status: "burned", owner: "" })).resolves.toMatchObject({ status: "burned", owner: "" })
        await expect(read({ ...token, status: "revoked", owner: "" })).resolves.toMatchObject({ status: "revoked", owner: "" })
    })

    it.each([
        ["an unknown field", { ...token, approved: "" }, "Invalid token fields"],
        ["an unknown status", { ...token, status: "frozen" }, "Invalid token status"],
        ["an active token without an owner", { ...token, owner: "" }, "Invalid token owner"],
        ["a burned token that still has an owner", { ...token, status: "burned" }, "Inconsistent token owner"],
        ["a revoked token that still has an owner", { ...token, status: "revoked" }, "Inconsistent token owner"],
        ["a token number that is not a decimal string", { ...token, number: 1 }, "Invalid token number"],
        ["a token numbered zero", { ...token, number: "0" }, "Invalid token number"],
        ["a token of another collection", { ...token, collection: "C2" }, "Token does not match the request"],
        ["another token of the collection", { ...token, number: "2" }, "Token does not match the request"],
        ["a null answer", null, "Invalid token"],
    ])("rejects %s", async (_name, row, message) => {
        await expect(read(row)).rejects.toThrow(new RegExp(`^${message}$`))
    })

    it("reports an unreadable token as an error and never asks for a negative number", async () => {
        queryEval.mockResolvedValueOnce(null)
        const unread = getToken("C1", 1n)
        await expect(unread).rejects.toThrow("Could not read token")
        await expect(unread).rejects.toBeInstanceOf(ReadError)
        queryEval.mockClear()
        await expect(getToken("C1", -1n)).rejects.toThrow("Invalid token number")
        expect(queryEval).not.toHaveBeenCalled()
    })

    it("never trusts the type of a number on its way into the expression", async () => {
        await expect(getToken("C1", '1) + ("' as unknown as bigint)).rejects.toThrow("Invalid token number")
        await expect(getToken("C1", 1.5 as unknown as bigint)).rejects.toThrow("Invalid token number")
        // The realm takes an int64: a larger number is never sent.
        await expect(getToken("C1", 2n ** 63n)).rejects.toThrow("Invalid token number")
        expect(queryEval).not.toHaveBeenCalled()
    })
})

describe("token list", () => {
    const burned = { ...token, number: "2", owner: "", status: "burned", uri: "ipfs://sample/2.json" }

    it("reads a page of tokens in number order, retired ones included", async () => {
        answer([token, burned])
        await expect(listTokens("C1")).resolves.toEqual([{ ...token, number: 1n }, { ...burned, number: 2n }])
        expect(queryEval).toHaveBeenCalledWith(GNO_RPC_URL, NFT_LEDGER_PATH, 'TokensJSON("C1", 0, 20)', true)
        answer([{ ...token, number: "5" }, { ...token, number: "6" }])
        await expect(listTokens("C1", 2, 2)).resolves.toMatchObject([{ number: 5n }, { number: 6n }])
        expect(queryEval).toHaveBeenLastCalledWith(GNO_RPC_URL, NFT_LEDGER_PATH, 'TokensJSON("C1", 2, 2)', true)
        answer([])
        await expect(listTokens("C1", 9, 50)).resolves.toEqual([])
    })

    it.each([
        ["an answer that is not a list", { tokens: [] }, "Invalid token list"],
        ["more rows than the page size", [token, burned, { ...token, number: "3" }], "Invalid token list"],
        ["a page that starts at the wrong number", [burned], "Token does not match the request"],
        ["a gap in the numbers", [token, { ...token, number: "3" }], "Token does not match the request"],
        ["the same token twice", [token, token], "Token does not match the request"],
        ["a token of another collection", [token, { ...burned, collection: "C2" }], "Token does not match the request"],
        ["a token with an unknown field", [{ ...token, approved: "" }], "Invalid token fields"],
        ["a token with a missing field", [without(token, "uri")], "Invalid token fields"],
        ["a burned token that still has an owner", [token, { ...burned, owner: addr(4) }], "Inconsistent token owner"],
        ["an unknown status", [{ ...token, status: "frozen" }], "Invalid token status"],
    ])("rejects %s", async (_name, rows, message) => {
        answer(rows)
        await expect(listTokens("C1", 0, 2)).rejects.toThrow(new RegExp(`^${message}$`))
    })

    it("reports an unreadable or undecodable list as an error, never as an empty collection", async () => {
        queryEval.mockResolvedValueOnce(null)
        await expect(listTokens("C1")).rejects.toThrow("Could not read tokens")
        queryEval.mockResolvedValueOnce("not a qeval answer")
        await expect(listTokens("C1")).rejects.toThrow(/^Invalid tokens$/)
    })

    it.each([[-1, 20], [0.5, 20], [0, 0], [0, 51]])("never asks the chain for page %d of size %d", async (page, size) => {
        await expect(listTokens("C1", page, size)).rejects.toThrow("Invalid token page")
        expect(queryEval).not.toHaveBeenCalled()
    })
})

describe("holdings", () => {
    const holding = { collection: "C2", number: "3", uri: "ipfs://sample/3.json" }
    const read = (rows: unknown) => { answer(rows); return listHoldings(addr(4), 0, 3) }

    it("reads what an account holds, in collection then number order", async () => {
        // C10 comes after C2: collections are ordered by their number, not as text.
        await expect(read([holding, { ...holding, number: "10" }, { ...holding, collection: "C10", number: "1" }])).resolves.toEqual([
            { ...holding, number: 3n }, { ...holding, number: 10n }, { ...holding, collection: "C10", number: 1n },
        ])
        expect(queryEval).toHaveBeenCalledWith(GNO_RPC_URL, NFT_LEDGER_PATH, `HoldingsJSON("${addr(4)}", 0, 3)`, true)
        await expect(read([])).resolves.toEqual([])
    })

    it.each([
        ["an answer that is not a list", { holdings: [] }, "Invalid holding list"],
        ["more rows than the page size", [1, 2, 3, 4].map((n) => ({ ...holding, number: String(n) })), "Invalid holding list"],
        ["a holding with an unknown field", [{ ...holding, owner: addr(4) }], "Invalid holding fields"],
        ["a holding with a missing field", [without(holding, "uri")], "Invalid holding fields"],
        ["a malformed collection ID", [{ ...holding, collection: "2" }], "Invalid collection ID"],
        ["a token numbered zero", [{ ...holding, number: "0" }], "Invalid token number"],
        ["a token number that is not a decimal string", [{ ...holding, number: 3 }], "Invalid token number"],
        ["a URI that is not text", [{ ...holding, uri: null }], "Invalid token URI"],
        ["collections out of order", [{ ...holding, collection: "C10" }, holding], "Holdings out of order"],
        ["numbers out of order", [holding, { ...holding, number: "2" }], "Holdings out of order"],
        ["the same token twice", [holding, holding], "Holdings out of order"],
    ])("rejects %s", async (_name, rows, message) => {
        await expect(read(rows)).rejects.toThrow(new RegExp(`^${message}$`))
    })

    it("reports unreadable holdings as an error, never as an empty wallet", async () => {
        queryEval.mockResolvedValueOnce(null)
        await expect(listHoldings(addr(4))).rejects.toThrow("Could not read holdings")
    })

    it.each(["", "g1owner", `${addr(4)}", 0, 1) + ("`])("never sends the malformed owner %j to the chain", async (owner) => {
        await expect(listHoldings(owner)).rejects.toThrow("Invalid owner")
        await expect(listHoldings(addr(4), 0, 51)).rejects.toThrow("Invalid holding page")
        expect(queryEval).not.toHaveBeenCalled()
    })
})

describe("approval", () => {
    const approval = { collection: "C1", number: "1", owner: addr(4), operator: addr(5), tokenApproved: false, collectionApproved: true }
    const read = (row: unknown) => { answer(row); return getApproval("C1", 1n, addr(5)) }

    it("reads whether an operator may move a token", async () => {
        await expect(read(approval)).resolves.toEqual({ owner: addr(4), tokenApproved: false, collectionApproved: true })
        expect(queryEval).toHaveBeenCalledWith(GNO_RPC_URL, NFT_LEDGER_PATH, `ApprovalJSON("C1", 1, "${addr(5)}")`, true)
    })

    it.each([
        ["an unknown field", { ...approval, approved: true }, "Invalid approval fields"],
        ["a missing field", without(approval, "collectionApproved"), "Invalid approval fields"],
        ["the approval of another collection", { ...approval, collection: "C2" }, "Approval does not match the request"],
        ["the approval of another token", { ...approval, number: "2" }, "Approval does not match the request"],
        ["the approval of another operator", { ...approval, operator: addr(6) }, "Approval does not match the request"],
        ["a token number that is not a decimal string", { ...approval, number: 1 }, "Invalid token number"],
        ["a token without an owner", { ...approval, owner: "" }, "Invalid token owner"],
        ["an approval that is not a boolean", { ...approval, tokenApproved: "false" }, "Invalid token approved"],
        ["a collection approval that is not a boolean", { ...approval, collectionApproved: 1 }, "Invalid collection approved"],
    ])("rejects %s", async (_name, row, message) => {
        await expect(read(row)).rejects.toThrow(new RegExp(`^${message}$`))
    })

    it("reports an unreadable approval as an error and never sends a malformed argument", async () => {
        queryEval.mockResolvedValueOnce(null)
        await expect(getApproval("C1", 1n, addr(5))).rejects.toThrow("Could not read approval")
        queryEval.mockClear()
        await expect(getApproval("C1", -1n, addr(5))).rejects.toThrow("Invalid token number")
        await expect(getApproval("C1", 1n, `${addr(5)}") + ("`)).rejects.toThrow("Invalid operator")
        expect(queryEval).not.toHaveBeenCalled()
    })
})

describe("capabilities", () => {
    const read = (row: unknown) => { answer(row); return getCapabilities("C1") }
    const guarded = { ...capabilities, mode: "royalty_protected", holderTransfer: false, markets: [addr(3)], royaltyBPS: "500", royaltyEnforcement: "listed_markets" }
    const bound = { ...capabilities, mode: "soulbound", holderTransfer: false, marketSale: false }

    it("reads the realm's own answer for an open, a royalty-protected and a soulbound collection", async () => {
        const answered = (json: string, id: string) => { queryEval.mockResolvedValueOnce(quoted(json)); return getCapabilities(id) }
        await expect(answered(REALM_CAPABILITIES_STATIC, "C1")).resolves.toEqual({ ...capabilities, maxSupply: 0n, royaltyBPS: 0n })
        await expect(answered(REALM_CAPABILITIES_PROTECTED, "C3")).resolves.toEqual({
            ...guarded, collection: "C3", markets: [MARKET], maxSupply: 10n, royaltyBPS: 500n,
        })
        await expect(answered(REALM_CAPABILITIES_SOULBOUND, "C4")).resolves.toEqual({ ...bound, collection: "C4", creatorRevoke: true, maxSupply: 3n, royaltyBPS: 0n })
    })

    it("reads the capabilities of a collection", async () => {
        await expect(read(capabilities)).resolves.toEqual({ ...capabilities, maxSupply: 7n, royaltyBPS: 0n })
        expect(queryEval).toHaveBeenCalledWith(GNO_RPC_URL, NFT_LEDGER_PATH, 'CapabilitiesJSON("C1")', true)
        await expect(read(guarded)).resolves.toMatchObject({ markets: [addr(3)], royaltyBPS: 500n, royaltyEnforcement: "listed_markets" })
        await expect(read({ ...capabilities, royaltyBPS: "250", royaltyEnforcement: "market_sales" })).resolves.toMatchObject({ royaltyEnforcement: "market_sales" })
        await expect(read({ ...bound, creatorRevoke: true })).resolves.toMatchObject({ creatorRevoke: true, royaltyEnforcement: "none" })
    })

    it.each([
        ["a schema this reader does not know", { ...capabilities, schema: "launchpad-nft-capabilities/v2" }, "Unsupported capabilities schema"],
        ["another token standard", { ...capabilities, standard: "grc1155" }, "Unsupported token standard"],
        ["the capabilities of another collection", { ...capabilities, collection: "C2" }, "Capabilities do not match the request"],
        ["a missing field", without(capabilities, "creatorRevoke"), "Invalid capabilities fields"],
        ["the revoke right under its former name", { ...without(capabilities, "creatorRevoke"), issuerRevoke: false }, "Invalid capabilities fields"],
        ["an unknown mode", { ...capabilities, mode: "tradable" }, "Invalid collection mode"],
        ["an unknown metadata mode", { ...capabilities, metadataMode: "hidden" }, "Invalid metadata mode"],
        ["an unknown royalty enforcement", { ...capabilities, royaltyEnforcement: "sometimes" }, "Invalid royalty enforcement"],
        ["an enforcement the ledger no longer claims", { ...guarded, royaltyEnforcement: "all_transfers" }, "Invalid royalty enforcement"],
        ["listed markets on an open collection", { ...capabilities, royaltyBPS: "250", royaltyEnforcement: "listed_markets" }, "Inconsistent royalty enforcement"],
        ["a royalty-protected collection held to market sales only", { ...guarded, royaltyEnforcement: "market_sales" }, "Inconsistent royalty enforcement"],
        ["a royalty-protected collection held to nothing", { ...guarded, royaltyEnforcement: "none" }, "Inconsistent royalty enforcement"],
        ["a royalty-protected collection without royalties", { ...guarded, royaltyBPS: "0" }, "Inconsistent royalty enforcement"],
        ["market sales on a soulbound collection", { ...bound, royaltyBPS: "250", royaltyEnforcement: "market_sales" }, "Inconsistent royalty enforcement"],
        ["a soulbound collection with royalties", { ...bound, royaltyBPS: "250" }, "Inconsistent royalty enforcement"],
        ["a soulbound token its holder may transfer", { ...bound, holderTransfer: true }, "Inconsistent holder rights"],
        ["a soulbound token a market may sell", { ...bound, marketSale: true }, "Inconsistent holder rights"],
        ["a royalty-protected token its holder may transfer", { ...guarded, holderTransfer: true }, "Inconsistent holder rights"],
        ["a royalty-protected token no market may sell", { ...guarded, marketSale: false }, "Inconsistent holder rights"],
        ["an open token its holder may not transfer", { ...capabilities, holderTransfer: false }, "Inconsistent holder rights"],
        ["market sales without royalties", { ...capabilities, royaltyEnforcement: "market_sales" }, "Inconsistent royalty enforcement"],
        ["royalties that nothing enforces", { ...capabilities, royaltyBPS: "250" }, "Inconsistent royalty enforcement"],
        ["a capability that is not a boolean", { ...capabilities, holderTransfer: "true" }, "Invalid holder transfer"],
        ["a malformed market address", { ...capabilities, markets: ["market"] }, "Invalid market"],
        ["an open collection naming a market", { ...capabilities, markets: [addr(3)] }, "Inconsistent collection markets"],
        ["a soulbound collection naming a market", { ...bound, markets: [addr(3)] }, "Inconsistent collection markets"],
        ["a royalty-protected collection without a market", { ...guarded, markets: [] }, "Inconsistent collection markets"],
        ["a royalty-protected collection with six markets", { ...guarded, markets: [3, 4, 5, 6, 7, 8].map(addr) }, "Inconsistent collection markets"],
        ["a supply that is not a decimal string", { ...capabilities, maxSupply: 7 }, "Invalid max supply"],
    ])("rejects %s", async (_name, row, message) => {
        await expect(read(row)).rejects.toThrow(new RegExp(`^${message}$`))
    })

    it("reports unreadable capabilities as retryable", async () => {
        queryEval.mockResolvedValueOnce(null)
        const unread = getCapabilities("C1")
        await expect(unread).rejects.toThrow("Could not read capabilities")
        await expect(unread).rejects.toBeInstanceOf(ReadError)
    })
})
