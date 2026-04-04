/**
 * nftMarketplace.test.ts — Unit tests for marketplace parsers and message builders.
 *
 * v3.1: Covers listing parser, sales parser, and all 5 MsgCall builders.
 */

import { describe, it, expect } from "vitest"
import {
    parseMarketplaceRender,
    parseSalesRender,
    buildListForSaleMsg,
    buildDelistMsg,
    buildBuyNFTMsg,
    buildMakeOfferMsg,
    buildCancelOfferMsg,
} from "./nftMarketplace"

// ── Test Data ────────────────────────────────────────────────

const MARKETPLACE_RENDER = `# NFT Marketplace

**Active Listings:** 3

| # | Collection | Token | Price | Seller |
|---|-----------|-------|-------|--------|
| 1 | my_nft | token1 | 1.000000 GNOT | g1abc12345... |
| 2 | art_collection | rare_001 | 5.500000 GNOT | g1def67890... |
| 3 | punks | 42 | 0.250000 GNOT | g1xyz11111... |
`

const EMPTY_MARKETPLACE = `# NFT Marketplace

**Active Listings:** 0

*No active listings.*
`

const SALES_RENDER = `# Recent Sales

| Sale | Collection | Token | Price | Seller | Buyer |
|------|-----------|-------|-------|--------|-------|
| 3 | my_nft | token1 | 1.000000 GNOT | g1abc... | g1xyz... |
| 2 | art | rare | 10.000000 GNOT | g1def... | g1ghi... |
| 1 | punks | 42 | 0.500000 GNOT | g1jkl... | g1mno... |
`

const EMPTY_SALES = `# Recent Sales

*No sales yet.*
`

// ── Parser Tests ─────────────────────────────────────────────

describe("parseMarketplaceRender", () => {
    it("parses listings from markdown table", () => {
        const { listings, stats } = parseMarketplaceRender(MARKETPLACE_RENDER)
        expect(listings).toHaveLength(3)
        expect(stats.activeListings).toBe(3)
    })

    it("extracts correct listing data", () => {
        const { listings } = parseMarketplaceRender(MARKETPLACE_RENDER)
        expect(listings[0]).toEqual({
            index: 1,
            nftRealm: "my_nft",
            tokenId: "token1",
            priceUgnot: 1_000_000,
            seller: "g1abc12345...",
            type: "grc721",
        })
    })

    it("parses fractional GNOT prices", () => {
        const { listings } = parseMarketplaceRender(MARKETPLACE_RENDER)
        expect(listings[1].priceUgnot).toBe(5_500_000)
        expect(listings[2].priceUgnot).toBe(250_000)
    })

    it("handles empty marketplace", () => {
        const { listings, stats } = parseMarketplaceRender(EMPTY_MARKETPLACE)
        expect(listings).toHaveLength(0)
        expect(stats.activeListings).toBe(0)
    })

    it("handles malformed data gracefully", () => {
        const { listings } = parseMarketplaceRender("random garbage\nnot a table")
        expect(listings).toHaveLength(0)
    })

    it("handles empty string", () => {
        const { listings, stats } = parseMarketplaceRender("")
        expect(listings).toHaveLength(0)
        expect(stats.activeListings).toBe(0)
    })
})

describe("parseSalesRender", () => {
    it("parses sales from markdown table", () => {
        const sales = parseSalesRender(SALES_RENDER)
        expect(sales).toHaveLength(3)
    })

    it("extracts correct sale data", () => {
        const sales = parseSalesRender(SALES_RENDER)
        expect(sales[0]).toEqual({
            saleId: 3,
            collection: "my_nft",
            tokenId: "token1",
            priceFormatted: "1.000000 GNOT",
            seller: "g1abc...",
            buyer: "g1xyz...",
        })
    })

    it("handles empty sales", () => {
        const sales = parseSalesRender(EMPTY_SALES)
        expect(sales).toHaveLength(0)
    })

    it("handles malformed data", () => {
        const sales = parseSalesRender("no table here")
        expect(sales).toHaveLength(0)
    })
})

// ── MsgCall Builder Tests ────────────────────────────────────

const CALLER = "g1testcaller"
const MARKET = "gno.land/r/samcrew/nft_market"
const NFT_REALM = "gno.land/r/user/my_nft"
const TOKEN_ID = "token_42"

describe("buildListForSaleMsg", () => {
    it("builds correct MsgCall for ListNFT", () => {
        const msg = buildListForSaleMsg(CALLER, MARKET, NFT_REALM, TOKEN_ID, 1_000_000)
        expect(msg.type).toBe("vm/MsgCall")
        expect(msg.value.func).toBe("ListNFT")
        expect(msg.value.pkg_path).toBe(MARKET)
        expect(msg.value.args).toEqual([NFT_REALM, TOKEN_ID, "1000000"])
        expect(msg.value.caller).toBe(CALLER)
        expect(msg.value.send).toBe("")
    })
})

describe("buildDelistMsg", () => {
    it("builds correct MsgCall for DelistNFT", () => {
        const msg = buildDelistMsg(CALLER, MARKET, NFT_REALM, TOKEN_ID)
        expect(msg.type).toBe("vm/MsgCall")
        expect(msg.value.func).toBe("DelistNFT")
        expect(msg.value.args).toEqual([NFT_REALM, TOKEN_ID])
    })
})

describe("buildBuyNFTMsg", () => {
    it("builds correct MsgCall with payment", () => {
        const msg = buildBuyNFTMsg(CALLER, MARKET, NFT_REALM, TOKEN_ID, 5_000_000)
        expect(msg.type).toBe("vm/MsgCall")
        expect(msg.value.func).toBe("BuyNFT")
        expect(msg.value.send).toBe("5000000ugnot")
        expect(msg.value.args).toEqual([NFT_REALM, TOKEN_ID])
    })
})

describe("buildMakeOfferMsg", () => {
    it("builds correct MsgCall with escrow amount", () => {
        const msg = buildMakeOfferMsg(CALLER, MARKET, NFT_REALM, TOKEN_ID, 2_000_000)
        expect(msg.type).toBe("vm/MsgCall")
        expect(msg.value.func).toBe("MakeOffer")
        expect(msg.value.send).toBe("2000000ugnot")
        expect(msg.value.args).toEqual([NFT_REALM, TOKEN_ID])
    })
})

describe("buildCancelOfferMsg", () => {
    it("builds correct MsgCall for CancelOffer", () => {
        const msg = buildCancelOfferMsg(CALLER, MARKET, NFT_REALM, TOKEN_ID)
        expect(msg.type).toBe("vm/MsgCall")
        expect(msg.value.func).toBe("CancelOffer")
        expect(msg.value.send).toBe("")
        expect(msg.value.args).toEqual([NFT_REALM, TOKEN_ID])
    })
})
