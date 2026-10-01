import { describe, expect, it } from "vitest"
import { derivePkgBech32Addr } from "../dao/realmAddress"
import { NFT_LEDGER_PATH } from "./ledger"
import { NFT_MARKET_PATH, type NftListing } from "./market"
import { NFT_MARKET_ADDRESS, buildBuyMsg, buildCancelListingMsg, buildListMsgs, buyBlocker, listingExpiry } from "./trade"

const BUYER = "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5"
const SELLER = "g1c0j899h88nwyvnzvh5jagpq6fkkyuj76nld6t0"
const listing = (more: Partial<NftListing> = {}): NftListing => ({
    id: "L12", collection: "C1", number: 5n, seller: SELLER, price: 2_000_000n, currency: "ugnot", createdAt: 1n, expiresAt: 2n, feeBPS: 50n,
    buyable: true, split: { seller: 1_990_000n, fee: 10_000n, royalties: [] }, ...more,
})

describe("listing calls", () => {
    it("buys with exactly the price attached, naming the currency and price read", () => {
        expect(buildBuyMsg(BUYER, listing())).toEqual({
            type: "vm/MsgCall",
            value: { caller: BUYER, send: "2000000ugnot", pkg_path: NFT_MARKET_PATH, func: "Buy", args: ["L12", "ugnot", "2000000"], max_deposit: "800000ugnot" },
        })
    })

    it("cancels the seller's own listing with nothing attached", () => {
        expect(buildCancelListingMsg(SELLER, listing())).toEqual({
            type: "vm/MsgCall",
            value: { caller: SELLER, send: "", pkg_path: NFT_MARKET_PATH, func: "Cancel", args: ["L12"], max_deposit: "100000ugnot" },
        })
        expect(() => buildCancelListingMsg(BUYER, listing())).toThrow("Only the seller")
    })

    it("refuses a purchase the realm would refuse, before any wallet", () => {
        expect(() => buildBuyMsg(SELLER, listing())).toThrow("This is your listing.")
        expect(() => buildBuyMsg(BUYER, listing({ buyable: false }))).toThrow("cannot be bought now")
        expect(() => buildBuyMsg(BUYER, listing({ currency: "gno.land/r/demo/foo20" }))).toThrow("Buying in a token")
        expect(() => buildBuyMsg(BUYER.toUpperCase(), listing())).toThrow("Invalid account")
    })

    it("lets a guest see a listing as buyable: it is asked to connect", () => {
        expect(buyBlocker(listing(), "")).toBe("")
        expect(buyBlocker(listing({ seller: BUYER }), BUYER)).toBe("This is your listing.")
    })
})

describe("listing a token", () => {
    const terms = { collection: "C1", number: 5n, price: 2_000_000n, expiresAt: 1_800_000_000n, maxFeeBPS: 50n }

    it("approves the market for this one token, then lists it, in one transaction", () => {
        expect(buildListMsgs(SELLER, terms)).toEqual([
            { type: "vm/MsgCall", value: { caller: SELLER, send: "", pkg_path: NFT_LEDGER_PATH, func: "Approve", args: ["C1", NFT_MARKET_ADDRESS, "5"], max_deposit: "300000ugnot" } },
            { type: "vm/MsgCall", value: { caller: SELLER, send: "", pkg_path: NFT_MARKET_PATH, func: "List", args: ["C1", "5", "2000000", "1800000000", "ugnot", "50"], max_deposit: "1000000ugnot" } },
        ])
    })

    it("approves the market realm's own address", async () => {
        expect(await derivePkgBech32Addr(NFT_MARKET_PATH)).toBe(NFT_MARKET_ADDRESS)
    })

    it("refuses terms the realm would refuse, before any wallet", () => {
        expect(() => buildListMsgs(SELLER, { ...terms, price: 0n })).toThrow("price above zero")
        expect(() => buildListMsgs(SELLER, { ...terms, number: 0n })).toThrow("Invalid token number")
        expect(() => buildListMsgs(SELLER, { ...terms, collection: "C01" })).toThrow("Invalid collection ID")
        expect(() => buildListMsgs(SELLER, { ...terms, maxFeeBPS: -1n })).toThrow("Invalid maximum fee")
        expect(() => buildListMsgs(SELLER.toUpperCase(), terms)).toThrow("Invalid account")
    })

    it("dates a listing from now, keeping the longest an hour inside the realm's 90 days", () => {
        expect(listingExpiry(1_000.7, 1)).toBe(87_400n)
        expect(listingExpiry(1_000, 30)).toBe(1_000n + 30n * 86_400n)
        expect(listingExpiry(1_000, 90)).toBe(1_000n + 90n * 86_400n - 3_600n)
    })
})
