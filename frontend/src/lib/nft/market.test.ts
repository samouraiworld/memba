import { beforeEach, describe, expect, it, vi } from "vitest"
import { GNO_RPC_URL } from "../config"
import { bech32Encode } from "../dao/realmAddress"
import { AbciQueryError } from "../rpcFallback"
import {
    NFT_MARKET_PATH, escrowOf, getListing, getMarketTerms, getOffer, getTokenListing, listBuyerOffers, listCollectionListings,
    listCollectionOffers, listListings, listOffers, listSellerListings,
} from "./market"
import { ReadError, RealmRefusedError } from "./read"

const queryEval = vi.hoisted(() => vi.fn())
vi.mock("../dao/shared", async (original) => ({ ...(await original<typeof import("../dao/shared")>()), queryEval }))

/** Sixteen addresses with valid checksums, in strictly ascending order. */
const ADDRESSES = Array.from({ length: 16 }, (_, n) => bech32Encode("g", new Uint8Array(20).fill(n))).sort()
const addr = (n: number) => ADDRESSES[n]
const qeval = (value: unknown) => `(${JSON.stringify(JSON.stringify(value))} string)`
const answer = (value: unknown) => queryEval.mockResolvedValueOnce(qeval(value))
const without = (row: Record<string, unknown>, key: string) => Object.fromEntries(Object.entries(row).filter(([name]) => name !== key))

/** A price of 10000 at a 2% fee and 5% royalties. */
const split = { seller: "9300", fee: "200", royalties: [{ account: addr(1), amount: "400" }, { account: addr(2), amount: "100" }] }
const typedSplit = { seller: 9300n, fee: 200n, royalties: [{ account: addr(1), amount: 400n }, { account: addr(2), amount: 100n }] }
const order = { collection: "C1", price: "10000", currency: "ugnot", createdAt: "1000", expiresAt: "2000", feeBPS: "200", split }
const typedOrder = { collection: "C1", price: 10000n, currency: "ugnot", createdAt: 1000n, expiresAt: 2000n, feeBPS: 200n, split: typedSplit }

const listing = { id: "L3", number: "7", seller: addr(4), buyable: true, ...order }
/**
 * What the market realm itself printed for `ListingJSON` of an open listing of
 * token 2 at 1000 ugnot with a 5% royalty, in its TestListingReads setup (gno
 * test at feat/t4-market-offers a7c6e03). Copied, not built from this reader's
 * model, so a change of the realm's contract breaks this test.
 */
const REALM_LISTING = `{"id":"L1","collection":"C1","number":"2","seller":"g1d44hgttnv4kxcetjta047h6lta047h6l6a6tmm","price":"1000","currency":"ugnot","createdAt":"1234567890","expiresAt":"1234654290","feeBPS":"50","buyable":true,"split":{"seller":"945","fee":"5","royalties":[{"account":"g1d44hgttnw36kg6t0ta047h6lta047h6l7fh742","amount":"50"}]}}`
const offer = { id: "O3", kind: "token", number: "7", trait: "", buyer: addr(5), ...order }
const collectionOffer = { ...offer, kind: "collection", number: "0" }
const traitOffer = { ...collectionOffer, kind: "trait", trait: "Background=Blue" }
const terms = { feeBPS: "200", maxFeeBPS: "200", treasury: addr(9), split }

/** What is wrong with an order is wrong whether it is a listing or an offer. */
const orderRefusals: [string, Record<string, unknown>, string][] = [
    ["a malformed collection ID", { collection: "C01" }, "Invalid collection ID"],
    ["a price that is not a decimal string", { price: 10000 }, "Invalid price"],
    ["a negative price", { price: "-10000" }, "Invalid price"],
    ["a price of zero", { price: "0", split: { seller: "0", fee: "0", royalties: [] } }, "Inconsistent order terms"],
    ["an expiry at its creation", { expiresAt: "1000" }, "Inconsistent order terms"],
    ["an expiry before its creation", { expiresAt: "999" }, "Inconsistent order terms"],
    ["a fee above the cap", { feeBPS: "201" }, "Inconsistent order terms"],
    ["a fee that is not set", { feeBPS: "-1" }, "Invalid fee bps"],
    ["a currency that is not a key", { currency: "u gnot" }, "Invalid currency"],
    ["a split that is not a record", { split: null }, "Invalid split"],
    ["a split with an unknown field", { split: { ...split, burn: "0" } }, "Invalid split fields"],
    ["a split with a missing field", { split: without(split, "fee") }, "Invalid split fields"],
    ["a split that pays out less than the price", { split: { ...split, seller: "9299" } }, "Inconsistent split"],
    ["a split that pays out more than the price", { split: { ...split, seller: "9301" } }, "Inconsistent split"],
    ["a fee that is not the pinned rate of the price", { split: { ...split, seller: "9400", fee: "100" } }, "Inconsistent split"],
    ["a fee rounded up", { price: "10049", split: { ...split, seller: "9348", fee: "201" } }, "Inconsistent split"],
    ["a split whose royalties are not a list", { split: { ...split, royalties: {} } }, "Invalid royalty payouts"],
    ["a royalty payout with an unknown field", { split: { ...split, royalties: [{ account: addr(1), amount: "500", bps: "500" }] } }, "Invalid royalty payout fields"],
    ["a malformed royalty account", { split: { ...split, royalties: [{ account: "receiver", amount: "500" }] } }, "Invalid royalty account"],
    ["a royalty amount that is not a decimal string", { split: { ...split, royalties: [{ account: addr(1), amount: 500 }] } }, "Invalid royalty amount"],
]

beforeEach(() => queryEval.mockReset())

describe("listing", () => {
    const read = (row: unknown) => { answer(row); return getListing("L3") }

    it("reads the realm's own answer", async () => {
        queryEval.mockResolvedValueOnce(`(${JSON.stringify(REALM_LISTING)} string)`)
        await expect(getListing("L1")).resolves.toEqual({
            id: "L1", collection: "C1", number: 2n, seller: "g1d44hgttnv4kxcetjta047h6lta047h6l6a6tmm", price: 1000n, currency: "ugnot",
            createdAt: 1234567890n, expiresAt: 1234654290n, feeBPS: 50n, buyable: true,
            split: { seller: 945n, fee: 5n, royalties: [{ account: "g1d44hgttnw36kg6t0ta047h6lta047h6l7fh742", amount: 50n }] },
        })
    })

    it("reads a listing with every field typed", async () => {
        await expect(read(listing)).resolves.toEqual({ id: "L3", number: 7n, seller: addr(4), buyable: true, ...typedOrder })
        expect(queryEval).toHaveBeenCalledWith(GNO_RPC_URL, NFT_MARKET_PATH, 'ListingJSON("L3")', true)
    })

    it.each([
        ["a listing that cannot be bought right now", { ...listing, buyable: false }],
        ["a sale without fee or royalties", { ...listing, feeBPS: "0", split: { seller: "10000", fee: "0", royalties: [] } }],
        ["a fee rounded down", { ...listing, price: "10049", split: { ...split, seller: "9349" } }],
    ])("accepts %s", async (_name, row) => {
        await expect(read(row)).resolves.toMatchObject({ id: "L3", buyable: row.buyable, price: BigInt(row.price) })
    })

    it.each([
        ["an unknown field", { ...listing, featured: false }, "Invalid listing fields"],
        ["a missing field", without(listing, "buyable"), "Invalid listing fields"],
        ["a renamed field", { ...without(listing, "seller"), owner: addr(4) }, "Invalid listing fields"],
        ["a listing that still carries a status", { ...listing, status: "active" }, "Invalid listing fields"],
        ["an offer where a listing is expected", offer, "Invalid listing fields"],
        ["a list where a listing is expected", [listing], "Invalid listing"],
        ["an ID with a leading zero", { ...listing, id: "L03" }, "Invalid listing ID"],
        ["an offer ID", { ...listing, id: "O3" }, "Invalid listing ID"],
        ["an ID beyond what the realm can issue", { ...listing, id: "L12345678901" }, "Invalid listing ID"],
        ["a buyable flag that is not a boolean", { ...listing, buyable: "true" }, "Invalid buyable"],
        ["a token numbered zero", { ...listing, number: "0" }, "Invalid token number"],
        ["a malformed seller", { ...listing, seller: "" }, "Invalid seller"],
        ...orderRefusals.map(([name, change, message]) => [name, { ...listing, ...change }, message] as const),
    ])("rejects %s", async (_name, row, message) => {
        await expect(read(row)).rejects.toThrow(new RegExp(`^${message}$`))
    })

    it("rejects an answer for another listing", async () => {
        await expect(read({ ...listing, id: "L4" })).rejects.toThrow("Listing does not match the request")
    })

    it("reads a listing that is closed or never existed as null", async () => {
        await expect(read(null)).resolves.toBeNull()
    })

    it("reports an unreadable or undecodable answer as an error, never as a closed listing", async () => {
        queryEval.mockResolvedValueOnce(null)
        const unread = getListing("L3")
        await expect(unread).rejects.toThrow("Could not read listing")
        await expect(unread).rejects.toBeInstanceOf(ReadError)
        queryEval.mockRejectedValueOnce(new AbciQueryError("vm/qeval", "invalid listing"))
        const refused = getListing("L3")
        await expect(refused).rejects.toBeInstanceOf(RealmRefusedError)
        await expect(refused).rejects.not.toBeInstanceOf(ReadError)
        for (const raw of ["not a qeval answer", "", "(null)", '("nul" string)', "(nil string)"]) {
            queryEval.mockResolvedValueOnce(raw)
            await expect(getListing("L3"), raw).rejects.toThrow(/^Invalid listing$/)
        }
    })

    it.each(["", "L0", "L01", "l1", "1", "O1", "L12345678901", 'L1") + ("'])("never sends the malformed ID %j to the chain", async (id) => {
        await expect(getListing(id)).rejects.toThrow("Invalid listing ID")
        expect(queryEval).not.toHaveBeenCalled()
    })
})

describe("token listing", () => {
    const read = (row: unknown) => { answer(row); return getTokenListing("C1", 7n) }

    it("reads the open listing of a token", async () => {
        await expect(read(listing)).resolves.toMatchObject({ id: "L3", collection: "C1", number: 7n, price: 10000n })
        expect(queryEval).toHaveBeenCalledWith(GNO_RPC_URL, NFT_MARKET_PATH, 'TokenListingJSON("C1", 7)', true)
    })

    it("reads a token without a listing as null", async () => {
        await expect(read(null)).resolves.toBeNull()
        queryEval.mockResolvedValueOnce('("null" string)\n')
        await expect(getTokenListing("C1", 7n)).resolves.toBeNull()
    })

    it("reports an unreadable or undecodable answer as an error, never as a token without a listing", async () => {
        queryEval.mockResolvedValueOnce(null)
        await expect(getTokenListing("C1", 7n)).rejects.toThrow("Could not read listing")
        for (const raw of ["not a qeval answer", "", "(null)", '("nul" string)', '("null" string) and more', "(nil string)"]) {
            queryEval.mockResolvedValueOnce(raw)
            await expect(getTokenListing("C1", 7n), raw).rejects.toThrow(/^Invalid listing$/)
        }
    })

    it.each([
        ["the listing of another token", { ...listing, number: "8" }, "Listing does not match the request"],
        ["the listing of another collection", { ...listing, collection: "C2" }, "Listing does not match the request"],
        ["a malformed listing", { ...listing, price: "0" }, "Inconsistent order terms"],
    ])("rejects %s", async (_name, row, message) => {
        await expect(read(row)).rejects.toThrow(new RegExp(`^${message}$`))
    })

    it("never sends a malformed argument to the chain", async () => {
        await expect(getTokenListing('C1", 7) + ("', 7n)).rejects.toThrow("Invalid collection ID")
        await expect(getTokenListing("C1", -7n)).rejects.toThrow("Invalid token number")
        await expect(getTokenListing("C1", "7) + (" as unknown as bigint)).rejects.toThrow("Invalid token number")
        expect(queryEval).not.toHaveBeenCalled()
    })
})

describe("listing lists", () => {
    const low = { ...listing, id: "L5", number: "2" }
    const older = { ...listing, id: "L2", number: "9", buyable: false }
    const otherCollection = { ...low, collection: "C2" }

    it("reads every open listing, newest first", async () => {
        answer([listing, older])
        await expect(listListings()).resolves.toMatchObject([{ id: "L3", buyable: true }, { id: "L2", buyable: false }])
        expect(queryEval).toHaveBeenCalledWith(GNO_RPC_URL, NFT_MARKET_PATH, 'ListingsJSON("", 20)', true)
    })

    it("reads on below the last listing already read, down to an empty slice", async () => {
        answer([listing, older])
        await expect(listListings("L4", 2)).resolves.toMatchObject([{ id: "L3" }, { id: "L2" }])
        expect(queryEval).toHaveBeenLastCalledWith(GNO_RPC_URL, NFT_MARKET_PATH, 'ListingsJSON("L4", 2)', true)
        answer([])
        await expect(listListings("L1", 50)).resolves.toEqual([])
        expect(queryEval).toHaveBeenLastCalledWith(GNO_RPC_URL, NFT_MARKET_PATH, 'ListingsJSON("L1", 50)', true)
    })

    it("reads the open listings of a collection in token number order, from the start or after a token", async () => {
        answer([low, listing])
        await expect(listCollectionListings("C1")).resolves.toMatchObject([{ id: "L5", number: 2n }, { id: "L3", number: 7n }])
        expect(queryEval).toHaveBeenCalledWith(GNO_RPC_URL, NFT_MARKET_PATH, 'CollectionListingsJSON("C1", 0, 20)', true)
        answer([listing])
        await expect(listCollectionListings("C1", 2n, 1)).resolves.toMatchObject([{ number: 7n }])
        expect(queryEval).toHaveBeenLastCalledWith(GNO_RPC_URL, NFT_MARKET_PATH, 'CollectionListingsJSON("C1", 2, 1)', true)
    })

    it("reads the open listings of a seller, oldest first, from the start or after a listing", async () => {
        answer([listing, otherCollection])
        await expect(listSellerListings(addr(4))).resolves.toMatchObject([{ id: "L3" }, { id: "L5", collection: "C2" }])
        expect(queryEval).toHaveBeenCalledWith(GNO_RPC_URL, NFT_MARKET_PATH, `SellerListingsJSON("${addr(4)}", "", 20)`, true)
        answer([otherCollection])
        await expect(listSellerListings(addr(4), "L3", 2)).resolves.toMatchObject([{ id: "L5" }])
        expect(queryEval).toHaveBeenLastCalledWith(GNO_RPC_URL, NFT_MARKET_PATH, `SellerListingsJSON("${addr(4)}", "L3", 2)`, true)
    })

    it.each([
        ["an answer that is not a list", { listings: [] }, "Invalid listing list"],
        ["a null answer", null, "Invalid listing list"],
        ["more rows than were asked for", [{ ...listing, id: "L9" }, { ...listing, id: "L8" }, listing], "Invalid listing list"],
        ["listings oldest first", [older, listing], "Unordered listing list"],
        ["the same listing twice", [listing, listing], "Unordered listing list"],
        ["a listing that still carries a status", [listing, { ...older, status: "filled" }], "Invalid listing fields"],
        ["a malformed listing", [listing, { ...older, price: "0" }], "Inconsistent order terms"],
    ])("rejects %s in the list of every open listing", async (_name, rows, message) => {
        answer(rows)
        await expect(listListings("", 2)).rejects.toThrow(new RegExp(`^${message}$`))
    })

    it.each([
        ["a listing of another collection", [low, { ...listing, collection: "C2" }], "Mismatched listing list"],
        ["token numbers out of order", [listing, low], "Unordered listing list"],
        ["two listings of one token", [listing, { ...listing, id: "L4" }], "Unordered listing list"],
    ])("rejects %s in the listings of a collection", async (_name, rows, message) => {
        answer(rows)
        await expect(listCollectionListings("C1")).rejects.toThrow(new RegExp(`^${message}$`))
    })

    it.each([
        ["a listing of another seller", [listing, { ...low, seller: addr(6) }], "Mismatched listing list"],
        ["listings newest first", [low, listing], "Unordered listing list"],
    ])("rejects %s in the listings of a seller", async (_name, rows, message) => {
        answer(rows)
        await expect(listSellerListings(addr(4))).rejects.toThrow(new RegExp(`^${message}$`))
    })

    it("rejects a listing that is not past the cursor", async () => {
        for (const before of ["L3", "L2", "L1"]) {
            answer([listing, older])
            await expect(listListings(before), before).rejects.toThrow(/^Mismatched listing list$/)
        }
        for (const afterNumber of [2n, 7n, 9n]) {
            answer([low, listing])
            await expect(listCollectionListings("C1", afterNumber), String(afterNumber)).rejects.toThrow(/^Mismatched listing list$/)
        }
        for (const afterId of ["L3", "L4", "L5"]) {
            answer([listing, low])
            await expect(listSellerListings(addr(4), afterId), afterId).rejects.toThrow(/^Mismatched listing list$/)
        }
    })

    it("reports an unreadable list as an error, never as an empty market", async () => {
        queryEval.mockResolvedValue(null)
        await expect(listListings()).rejects.toThrow("Could not read listings")
        await expect(listCollectionListings("C1")).rejects.toThrow("Could not read listings")
        await expect(listSellerListings(addr(4))).rejects.toThrow("Could not read listings")
    })

    it("never sends a malformed argument to the chain", async () => {
        for (const cursor of ["L0", "L03", "3", "O3", "L12345678901", 'L3", 1) + ("']) {
            await expect(listListings(cursor), cursor).rejects.toThrow("Invalid listing ID")
            await expect(listSellerListings(addr(4), cursor), cursor).rejects.toThrow("Invalid listing ID")
        }
        for (const size of [0, 51, 1.5, -1]) {
            await expect(listListings("", size)).rejects.toThrow("Invalid listing list size")
            await expect(listCollectionListings("C1", 0n, size)).rejects.toThrow("Invalid listing list size")
            await expect(listSellerListings(addr(4), "", size)).rejects.toThrow("Invalid listing list size")
        }
        await expect(listCollectionListings('C1", 0, 1) + ("')).rejects.toThrow("Invalid collection ID")
        await expect(listCollectionListings("C1", -1n)).rejects.toThrow("Invalid token number")
        await expect(listCollectionListings("C1", "0, 1) + (" as unknown as bigint)).rejects.toThrow("Invalid token number")
        await expect(listSellerListings(`${addr(4)}", "", 1) + ("`)).rejects.toThrow("Invalid seller")
        expect(queryEval).not.toHaveBeenCalled()
    })
})

describe("offer", () => {
    const read = (row: unknown) => { answer(row); return getOffer("O3") }

    it("reads an offer on a token with every field typed", async () => {
        await expect(read(offer)).resolves.toEqual({ id: "O3", kind: "token", number: 7n, trait: "", buyer: addr(5), ...typedOrder })
        expect(queryEval).toHaveBeenCalledWith(GNO_RPC_URL, NFT_MARKET_PATH, 'OfferJSON("O3")', true)
    })

    it.each([
        ["an offer on any token of a collection", collectionOffer],
        ["an offer on a trait", traitOffer],
        ["a trait of exactly one hundred bytes", { ...traitOffer, trait: `Background=${"x".repeat(89)}` }],
        ["a trait with spaces", { ...traitOffer, trait: "Eye color=Deep blue" }],
    ])("accepts %s", async (_name, row) => {
        await expect(read(row)).resolves.toMatchObject({ id: "O3", kind: row.kind, trait: row.trait, number: 0n })
    })

    it.each([
        ["an unknown field", { ...offer, seller: addr(4) }, "Invalid offer fields"],
        ["a missing field", without(offer, "trait"), "Invalid offer fields"],
        ["an offer that still carries a status", { ...offer, status: "active" }, "Invalid offer fields"],
        ["a listing where an offer is expected", listing, "Invalid offer fields"],
        ["text where an offer is expected", "O3", "Invalid offer"],
        ["a listing ID", { ...offer, id: "L3" }, "Invalid offer ID"],
        ["an ID with a leading zero", { ...offer, id: "O03" }, "Invalid offer ID"],
        ["an unknown kind", { ...offer, kind: "bundle" }, "Invalid offer kind"],
        ["a malformed buyer", { ...offer, buyer: "g1buyer" }, "Invalid buyer"],
        ["a trait that is not text", { ...offer, trait: null }, "Invalid trait"],
        ["a token number that is not a decimal string", { ...offer, number: 7 }, "Invalid token number"],
        ["a token offer without a number", { ...offer, number: "0" }, "Inconsistent offer target"],
        ["a token offer with a trait", { ...offer, trait: "Background=Blue" }, "Inconsistent offer target"],
        ["a collection offer with a number", { ...collectionOffer, number: "7" }, "Inconsistent offer target"],
        ["a collection offer with a trait", { ...collectionOffer, trait: "Background=Blue" }, "Inconsistent offer target"],
        ["a trait offer with a number", { ...traitOffer, number: "7" }, "Inconsistent offer target"],
        ["a trait offer without a trait", { ...traitOffer, trait: "" }, "Inconsistent offer target"],
        ["a trait without a value", { ...traitOffer, trait: "Background=" }, "Inconsistent offer target"],
        ["a trait without a type", { ...traitOffer, trait: "=Blue" }, "Inconsistent offer target"],
        ["a trait without a separator", { ...traitOffer, trait: "Background" }, "Inconsistent offer target"],
        ["a trait with two separators", { ...traitOffer, trait: "Background=Blue=Dark" }, "Inconsistent offer target"],
        ["a trait carrying the leaf separator", { ...traitOffer, trait: "Background=Blue|7" }, "Inconsistent offer target"],
        ["a trait of a hundred and one bytes", { ...traitOffer, trait: `Background=${"x".repeat(90)}` }, "Inconsistent offer target"],
        ["a trait over the limit in bytes though not in characters", { ...traitOffer, trait: `Background=${"é".repeat(45)}` }, "Inconsistent offer target"],
        ...orderRefusals.map(([name, change, message]) => [name, { ...offer, ...change }, message] as const),
    ])("rejects %s", async (_name, row, message) => {
        await expect(read(row)).rejects.toThrow(new RegExp(`^${message}$`))
    })

    it("rejects an answer for another offer", async () => {
        await expect(read({ ...offer, id: "O4" })).rejects.toThrow("Offer does not match the request")
    })

    it("reads an offer that is closed or never existed as null", async () => {
        await expect(read(null)).resolves.toBeNull()
    })

    it("reports an unreadable or undecodable answer as an error, never as a closed offer", async () => {
        queryEval.mockResolvedValueOnce(null)
        await expect(getOffer("O3")).rejects.toThrow("Could not read offer")
        for (const raw of ["not a qeval answer", "", "(null)", '("nul" string)', "(nil string)"]) {
            queryEval.mockResolvedValueOnce(raw)
            await expect(getOffer("O3"), raw).rejects.toThrow(/^Invalid offer$/)
        }
    })

    it.each(["", "O0", "O01", "o1", "1", "L1", "O12345678901", 'O1") + ("'])("never sends the malformed ID %j to the chain", async (id) => {
        await expect(getOffer(id)).rejects.toThrow("Invalid offer ID")
        expect(queryEval).not.toHaveBeenCalled()
    })
})

describe("offer lists", () => {
    const newer = { ...collectionOffer, id: "O5" }
    const older = { ...traitOffer, id: "O2" }

    it("reads every open offer, newest first", async () => {
        answer([newer, offer, older])
        await expect(listOffers()).resolves.toMatchObject([{ id: "O5", kind: "collection" }, { id: "O3", kind: "token" }, { id: "O2", kind: "trait" }])
        expect(queryEval).toHaveBeenCalledWith(GNO_RPC_URL, NFT_MARKET_PATH, 'OffersJSON("", 20)', true)
    })

    it("reads on below the last offer already read, down to an empty slice", async () => {
        answer([offer, older])
        await expect(listOffers("O5", 10)).resolves.toMatchObject([{ id: "O3" }, { id: "O2" }])
        expect(queryEval).toHaveBeenLastCalledWith(GNO_RPC_URL, NFT_MARKET_PATH, 'OffersJSON("O5", 10)', true)
        answer([])
        await expect(listOffers("O1", 50)).resolves.toEqual([])
    })

    it("reads the open offers of a collection, oldest first, from the start or after an offer", async () => {
        answer([offer, newer])
        await expect(listCollectionOffers("C1")).resolves.toMatchObject([{ id: "O3" }, { id: "O5" }])
        expect(queryEval).toHaveBeenCalledWith(GNO_RPC_URL, NFT_MARKET_PATH, 'CollectionOffersJSON("C1", "", 20)', true)
        answer([newer])
        await expect(listCollectionOffers("C1", "O3", 2)).resolves.toMatchObject([{ id: "O5" }])
        expect(queryEval).toHaveBeenLastCalledWith(GNO_RPC_URL, NFT_MARKET_PATH, 'CollectionOffersJSON("C1", "O3", 2)', true)
    })

    it("reads the open offers of a buyer, oldest first, from the start or after an offer", async () => {
        answer([offer, { ...newer, collection: "C2" }])
        await expect(listBuyerOffers(addr(5))).resolves.toMatchObject([{ id: "O3" }, { id: "O5", collection: "C2" }])
        expect(queryEval).toHaveBeenCalledWith(GNO_RPC_URL, NFT_MARKET_PATH, `BuyerOffersJSON("${addr(5)}", "", 20)`, true)
        answer([newer])
        await expect(listBuyerOffers(addr(5), "O4", 1)).resolves.toMatchObject([{ id: "O5" }])
        expect(queryEval).toHaveBeenLastCalledWith(GNO_RPC_URL, NFT_MARKET_PATH, `BuyerOffersJSON("${addr(5)}", "O4", 1)`, true)
    })

    it.each([
        ["an answer that is not a list", { offers: [] }, "Invalid offer list"],
        ["more rows than were asked for", [newer, { ...offer, id: "O4" }, offer], "Invalid offer list"],
        ["offers oldest first", [offer, newer], "Unordered offer list"],
        ["the same offer twice", [offer, offer], "Unordered offer list"],
        ["an offer that still carries a status", [newer, { ...offer, status: "accepted" }], "Invalid offer fields"],
        ["a malformed offer", [newer, { ...offer, trait: "Background=Blue" }], "Inconsistent offer target"],
    ])("rejects %s in the list of every open offer", async (_name, rows, message) => {
        answer(rows)
        await expect(listOffers("", 2)).rejects.toThrow(new RegExp(`^${message}$`))
    })

    it.each([
        ["an offer on another collection", [offer, { ...newer, collection: "C2" }], "Mismatched offer list"],
        ["offers newest first", [newer, offer], "Unordered offer list"],
    ])("rejects %s in the offers of a collection", async (_name, rows, message) => {
        answer(rows)
        await expect(listCollectionOffers("C1")).rejects.toThrow(new RegExp(`^${message}$`))
    })

    it.each([
        ["an offer of another buyer", [offer, { ...newer, buyer: addr(6) }], "Mismatched offer list"],
        ["offers newest first", [newer, offer], "Unordered offer list"],
    ])("rejects %s in the offers of a buyer", async (_name, rows, message) => {
        answer(rows)
        await expect(listBuyerOffers(addr(5))).rejects.toThrow(new RegExp(`^${message}$`))
    })

    it("rejects an offer that is not past the cursor", async () => {
        for (const before of ["O5", "O3", "O1"]) {
            answer([newer, offer])
            await expect(listOffers(before), before).rejects.toThrow(/^Mismatched offer list$/)
        }
        for (const afterId of ["O3", "O4", "O5"]) {
            answer([offer, newer])
            await expect(listCollectionOffers("C1", afterId), afterId).rejects.toThrow(/^Mismatched offer list$/)
            answer([offer, newer])
            await expect(listBuyerOffers(addr(5), afterId), afterId).rejects.toThrow(/^Mismatched offer list$/)
        }
    })

    it("reports an unreadable list as an error, never as an absence of offers", async () => {
        queryEval.mockResolvedValue(null)
        await expect(listOffers()).rejects.toThrow("Could not read offers")
        await expect(listCollectionOffers("C1")).rejects.toThrow("Could not read offers")
        await expect(listBuyerOffers(addr(5))).rejects.toThrow("Could not read offers")
    })

    it("never sends a malformed argument to the chain", async () => {
        for (const cursor of ["O0", "O03", "3", "L3", "O12345678901", 'O3", 1) + ("']) {
            await expect(listOffers(cursor), cursor).rejects.toThrow("Invalid offer ID")
            await expect(listCollectionOffers("C1", cursor), cursor).rejects.toThrow("Invalid offer ID")
            await expect(listBuyerOffers(addr(5), cursor), cursor).rejects.toThrow("Invalid offer ID")
        }
        for (const size of [0, 51, 1.5, -1]) {
            await expect(listOffers("", size)).rejects.toThrow("Invalid offer list size")
            await expect(listCollectionOffers("C1", "", size)).rejects.toThrow("Invalid offer list size")
            await expect(listBuyerOffers(addr(5), "", size)).rejects.toThrow("Invalid offer list size")
        }
        await expect(listCollectionOffers("C0")).rejects.toThrow("Invalid collection ID")
        await expect(listBuyerOffers(`${addr(5)}", "", 1) + ("`)).rejects.toThrow("Invalid buyer")
        expect(queryEval).not.toHaveBeenCalled()
    })
})

describe("market terms", () => {
    const read = (row: unknown, price = 10000n) => { answer(row); return getMarketTerms("C1", price) }

    it("reads what a sale costs now and how a price would split", async () => {
        await expect(read(terms)).resolves.toEqual({ feeBPS: 200n, maxFeeBPS: 200n, treasury: addr(9), split: typedSplit })
        expect(queryEval).toHaveBeenCalledWith(GNO_RPC_URL, NFT_MARKET_PATH, 'TermsJSON("C1", 10000)', true)
        await expect(read({ ...terms, feeBPS: "0", split: { seller: "0", fee: "0", royalties: [] } }, 0n)).resolves.toMatchObject({ feeBPS: 0n, split: { seller: 0n } })
    })

    it("reports a closed lane as null, never as a number", async () => {
        const unset = await read({ ...terms, feeBPS: "-1", treasury: "", split: null })
        expect(unset).toEqual({ feeBPS: null, maxFeeBPS: 200n, treasury: "", split: null })
    })

    it("reads a fee above the cap as terms without a split", async () => {
        await expect(read({ ...terms, maxFeeBPS: "100", split: null })).resolves.toEqual({ feeBPS: 200n, maxFeeBPS: 100n, treasury: addr(9), split: null })
    })

    it.each([
        ["an unknown field", { ...terms, currency: "ugnot" }, "Invalid market terms fields"],
        ["a missing field", without(terms, "split"), "Invalid market terms fields"],
        ["a negative fee that is not the sentinel", { ...terms, feeBPS: "-2" }, "Invalid fee bps"],
        ["a sentinel written as a number", { ...terms, feeBPS: -1 }, "Invalid fee bps"],
        ["a cap that is not set", { ...terms, maxFeeBPS: "-1" }, "Invalid maximum fee bps"],
        ["a cap above the realm's", { ...terms, maxFeeBPS: "201" }, "Inconsistent market terms"],
        ["a split quoted while the fee is not set", { ...terms, feeBPS: "-1" }, "Inconsistent market terms"],
        ["a split quoted at a fee above the cap", { ...terms, maxFeeBPS: "100" }, "Inconsistent market terms"],
        ["no split at a fee a new order could pin", { ...terms, split: null }, "Inconsistent market terms"],
        ["a split of another price", { ...terms, split: { ...split, seller: "19300" } }, "Inconsistent split"],
        ["a split at another fee", { ...terms, feeBPS: "100" }, "Inconsistent split"],
        ["a split that is not a record", { ...terms, split: [] }, "Invalid split"],
        ["a malformed treasury", { ...terms, treasury: "treasury" }, "Invalid treasury"],
    ])("rejects %s", async (_name, row, message) => {
        await expect(read(row)).rejects.toThrow(new RegExp(`^${message}$`))
    })

    it("reports unreadable terms as an error and never sends a malformed argument", async () => {
        queryEval.mockResolvedValueOnce(null)
        await expect(getMarketTerms("C1", 10000n)).rejects.toThrow("Could not read market terms")
        queryEval.mockClear()
        await expect(getMarketTerms('C1", 1) + ("', 10000n)).rejects.toThrow("Invalid collection ID")
        await expect(getMarketTerms("C1", -1n)).rejects.toThrow("Invalid price")
        await expect(getMarketTerms("C1", "1) + (" as unknown as bigint)).rejects.toThrow("Invalid price")
        expect(queryEval).not.toHaveBeenCalled()
    })
})

describe("escrow", () => {
    it("reads the total held for open offers in a currency", async () => {
        queryEval.mockResolvedValueOnce("(12345 int64)")
        await expect(escrowOf("ugnot")).resolves.toBe(12345n)
        expect(queryEval).toHaveBeenCalledWith(GNO_RPC_URL, NFT_MARKET_PATH, 'EscrowOf("ugnot")', true)
        queryEval.mockResolvedValueOnce("(0 int64)\n")
        await expect(escrowOf("gno.land/r/demo/tokens/v1.SAMPLE")).resolves.toBe(0n)
    })

    it.each(["(-1 int64)", "(12345 int)", '("12345" string)', "12345"])("rejects the amount %j", async (raw) => {
        queryEval.mockResolvedValueOnce(raw)
        await expect(escrowOf("ugnot")).rejects.toThrow(/^Invalid escrow$/)
    })

    it("reports an unreadable escrow as an error, never as zero", async () => {
        queryEval.mockResolvedValueOnce(null)
        await expect(escrowOf("ugnot")).rejects.toThrow("Could not read escrow")
    })

    it.each(["", "u gnot", 'ugnot") + ("', "a".repeat(101)])("never sends the malformed currency %j to the chain", async (currency) => {
        await expect(escrowOf(currency)).rejects.toThrow("Invalid currency")
        expect(queryEval).not.toHaveBeenCalled()
    })
})
