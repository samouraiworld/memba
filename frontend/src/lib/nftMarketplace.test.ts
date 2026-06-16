/**
 * nftMarketplace.test.ts — Unit tests for marketplace parsers and message builders.
 *
 * v4.0: Updated for live test13 realms. Builders now take collectionID (string)
 * as first arg instead of nftRealm path. Added buildSetApprovalForAllMsg and
 * buildApproveMsg (collection-scoped) tests.
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
    buildAcceptOfferMsg,
    buildSetApprovalForAllMsg,
    buildApproveMsg,
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
const MARKET = "gno.land/r/samcrew/memba_nft_market_v2"
const COLLECTION_PATH = "gno.land/r/samcrew/memba_nft_v2"
const COLLECTION_ID = "genesis"
const TOKEN_ID = "token_42"
const MARKET_ADDR = "g15unfxh9zfm75puw2lqmsun2lv8c397e0efkp2u"

describe("buildListForSaleMsg", () => {
    it("builds correct MsgCall for ListNFT with collectionID", () => {
        const msg = buildListForSaleMsg(CALLER, MARKET, COLLECTION_ID, TOKEN_ID, 1_000_000)
        expect(msg.type).toBe("vm/MsgCall")
        expect(msg.value.func).toBe("ListNFT")
        expect(msg.value.pkg_path).toBe(MARKET)
        expect(msg.value.args).toEqual([COLLECTION_ID, TOKEN_ID, "1000000"])
        expect(msg.value.caller).toBe(CALLER)
        expect(msg.value.send).toBe("")
    })
})

describe("buildDelistMsg", () => {
    it("builds correct MsgCall for DelistNFT with collectionID", () => {
        const msg = buildDelistMsg(CALLER, MARKET, COLLECTION_ID, TOKEN_ID)
        expect(msg.type).toBe("vm/MsgCall")
        expect(msg.value.func).toBe("DelistNFT")
        expect(msg.value.pkg_path).toBe(MARKET)
        expect(msg.value.args).toEqual([COLLECTION_ID, TOKEN_ID])
        expect(msg.value.send).toBe("")
    })
})

describe("buildBuyNFTMsg", () => {
    it("builds correct MsgCall with payment and collectionID", () => {
        const msg = buildBuyNFTMsg(CALLER, MARKET, COLLECTION_ID, TOKEN_ID, 5_000_000)
        expect(msg.type).toBe("vm/MsgCall")
        expect(msg.value.func).toBe("BuyNFT")
        expect(msg.value.send).toBe("5000000ugnot")
        expect(msg.value.args).toEqual([COLLECTION_ID, TOKEN_ID])
        expect(msg.value.pkg_path).toBe(MARKET)
    })
})

describe("buildMakeOfferMsg", () => {
    it("builds correct MsgCall with escrow amount and collectionID", () => {
        const msg = buildMakeOfferMsg(CALLER, MARKET, COLLECTION_ID, TOKEN_ID, 2_000_000)
        expect(msg.type).toBe("vm/MsgCall")
        expect(msg.value.func).toBe("MakeOffer")
        expect(msg.value.send).toBe("2000000ugnot")
        expect(msg.value.args).toEqual([COLLECTION_ID, TOKEN_ID])
        expect(msg.value.pkg_path).toBe(MARKET)
    })
})

describe("buildCancelOfferMsg", () => {
    it("builds correct MsgCall for CancelOffer with collectionID", () => {
        const msg = buildCancelOfferMsg(CALLER, MARKET, COLLECTION_ID, TOKEN_ID)
        expect(msg.type).toBe("vm/MsgCall")
        expect(msg.value.func).toBe("CancelOffer")
        expect(msg.value.send).toBe("")
        expect(msg.value.args).toEqual([COLLECTION_ID, TOKEN_ID])
        expect(msg.value.pkg_path).toBe(MARKET)
    })
})

describe("buildAcceptOfferMsg", () => {
    it("builds correct MsgCall for AcceptOffer with collectionID and buyer", () => {
        const msg = buildAcceptOfferMsg(CALLER, MARKET, COLLECTION_ID, TOKEN_ID, "g1buyer")
        expect(msg.type).toBe("vm/MsgCall")
        expect(msg.value.func).toBe("AcceptOffer")
        expect(msg.value.send).toBe("")
        expect(msg.value.args).toEqual([COLLECTION_ID, TOKEN_ID, "g1buyer"])
        expect(msg.value.pkg_path).toBe(MARKET)
    })
})

describe("buildSetApprovalForAllMsg", () => {
    it("builds correct MsgCall targeting the collection realm with collectionID", () => {
        const msg = buildSetApprovalForAllMsg(CALLER, COLLECTION_PATH, COLLECTION_ID, MARKET_ADDR, true)
        expect(msg.type).toBe("vm/MsgCall")
        expect(msg.value.func).toBe("SetApprovalForAll")
        // pkg_path must point to the COLLECTION, not the marketplace
        expect(msg.value.pkg_path).toBe(COLLECTION_PATH)
        expect(msg.value.args).toEqual([COLLECTION_ID, MARKET_ADDR, "true"])
        expect(msg.value.caller).toBe(CALLER)
        expect(msg.value.send).toBe("")
    })

    it("encodes approved=false correctly", () => {
        const msg = buildSetApprovalForAllMsg(CALLER, COLLECTION_PATH, COLLECTION_ID, MARKET_ADDR, false)
        expect(msg.value.args).toEqual([COLLECTION_ID, MARKET_ADDR, "false"])
    })
})

describe("buildApproveMsg (collection-scoped)", () => {
    it("builds correct MsgCall for per-token Approve targeting the collection", () => {
        const msg = buildApproveMsg(CALLER, COLLECTION_PATH, COLLECTION_ID, MARKET_ADDR, TOKEN_ID)
        expect(msg.type).toBe("vm/MsgCall")
        expect(msg.value.func).toBe("Approve")
        // pkg_path must point to the COLLECTION
        expect(msg.value.pkg_path).toBe(COLLECTION_PATH)
        expect(msg.value.args).toEqual([COLLECTION_ID, MARKET_ADDR, TOKEN_ID])
        expect(msg.value.caller).toBe(CALLER)
        expect(msg.value.send).toBe("")
    })
})
