import { describe, it, expect } from "vitest"
import {
    parseListingsPage,
    parseOffersForToken,
    unwrapQevalString,
} from "./v3Reads"

const SELLER = "g1pucv5exvs0pxlfe39qlyu4pge47llcx78nx5nj" // full bech32, not truncated
const BUYER = "g1hu6u2qrt69umc85g8vjuvp7dhfkfexw9tteef0"

describe("parseListingsPage (GetListingsPage: collectionID|tokenID|seller|price|createdBlk)", () => {
    it("parses full-address listing lines", () => {
        const decoded = `alice/cats|7|${SELLER}|124000000|18234\nbob/punks|3|${BUYER}|5000000|18250\n`
        const out = parseListingsPage(decoded)
        expect(out).toHaveLength(2)
        expect(out[0]).toEqual({
            collectionID: "alice/cats",
            tokenId: "7",
            seller: SELLER, // FULL address, no truncation
            priceUgnot: 124_000_000,
            createdBlk: 18234,
        })
        expect(out[1].collectionID).toBe("bob/punks")
        expect(out[1].seller).toBe(BUYER)
    })

    it("skips blank and malformed (too-few-field) lines", () => {
        const decoded = `alice/cats|7|${SELLER}|124000000|18234\n\ngarbage|line\n`
        expect(parseListingsPage(decoded)).toHaveLength(1)
    })

    it("returns [] for empty input", () => {
        expect(parseListingsPage("")).toEqual([])
    })
})

describe("parseOffersForToken (GetOffersForToken: buyer|amount|createdBlk)", () => {
    it("parses offer lines with full buyer addresses", () => {
        const decoded = `${BUYER}|700000|18300\n${SELLER}|800000|18305\n`
        const out = parseOffersForToken(decoded)
        expect(out).toHaveLength(2)
        expect(out[0]).toEqual({ buyer: BUYER, amountUgnot: 700_000, createdBlk: 18300 })
        // full buyer address is what AcceptOffer / ClaimExpiredOffer need
        expect(out[1].buyer).toBe(SELLER)
    })

    it("returns [] for empty / no-offers", () => {
        expect(parseOffersForToken("")).toEqual([])
        expect(parseOffersForToken("\n  \n")).toEqual([])
    })
})

describe("unwrapQevalString (vm/qeval string return)", () => {
    it("unwraps a literal-newline string return", () => {
        const raw = `("alice/cats|7|${SELLER}|124000000|18234\n" string)`
        expect(unwrapQevalString(raw)).toBe(`alice/cats|7|${SELLER}|124000000|18234\n`)
    })

    it("unwraps an escaped-\\n string return", () => {
        const raw = `("a|1|${SELLER}|1|2\\nb|2|${BUYER}|3|4\\n" string)`
        const decoded = unwrapQevalString(raw)
        expect(decoded.split("\n").filter(Boolean)).toHaveLength(2)
        expect(parseListingsPage(decoded)).toHaveLength(2)
    })

    it("passes through an already-unwrapped string", () => {
        expect(unwrapQevalString("a|1|x|2|3\n")).toBe("a|1|x|2|3\n")
    })

    it("end-to-end: qeval wrapper → parse", () => {
        const raw = `("alice/cats|7|${SELLER}|124000000|18234\n" string)`
        const out = parseListingsPage(unwrapQevalString(raw))
        expect(out[0].seller).toBe(SELLER)
        expect(out[0].priceUgnot).toBe(124_000_000)
    })
})
