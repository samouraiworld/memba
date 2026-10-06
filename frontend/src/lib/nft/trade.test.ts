import { describe, expect, it } from "vitest"
import { NFT_MARKET_PATH, type NftListing } from "./market"
import { buildBuyMsg, buildCancelListingMsg, buyBlocker } from "./trade"

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
