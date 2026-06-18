/**
 * nftMarketplaceV3.test.ts — TDD for the v3 trade library.
 *
 * Covers:
 * 1. All v3 MsgCall builders (correct pkg_path, func, args, send)
 * 2. SetApprovalForAll targets memba_collections (NOT the market)
 * 3. tradeEngineFor("v2") / tradeEngineFor("v3") return correct paths/addr/fee
 */

import { describe, it, expect } from "vitest"
import {
    buildListForSaleV3Msg,
    buildBuyNFTV3Msg,
    buildDelistV3Msg,
    buildMakeOfferV3Msg,
    buildCancelOfferV3Msg,
    buildAcceptOfferV3Msg,
    buildClaimExpiredOfferV3Msg,
    buildSetApprovalForAllV3Msg,
} from "./nftMarketplaceV3"
import { tradeEngineFor } from "./tradeEngine"
import {
    NFT_MARKETPLACE_V3_PATH,
    NFT_MARKET_V3_ADDR,
    NFT_COLLECTIONS_PATH,
    NFT_MARKETPLACE_PATH,
    NFT_MARKET_ADDR,
    PLATFORM_FEE_BPS_V2,
    PLATFORM_FEE_BPS_V3,
} from "./nftConfig"

// ── Fixtures ──────────────────────────────────────────────────

const CALLER = "g1testcalleraddr"
const COLLECTION_ID = "genesis"
const TOKEN_ID = "token1"
const BUYER_ADDR = "g1buyeraddr"
const PRICE = 1_500_000
const OFFER = 1_000_000

// ── 1. buildListForSaleV3Msg ──────────────────────────────────

describe("buildListForSaleV3Msg", () => {
    it("has type vm/MsgCall", () => {
        const msg = buildListForSaleV3Msg(CALLER, COLLECTION_ID, TOKEN_ID, PRICE)
        expect(msg.type).toBe("vm/MsgCall")
    })

    it("targets memba_nft_market_v3 (not v2)", () => {
        const msg = buildListForSaleV3Msg(CALLER, COLLECTION_ID, TOKEN_ID, PRICE)
        expect(msg.value.pkg_path).toBe(NFT_MARKETPLACE_V3_PATH)
        expect(msg.value.pkg_path).not.toBe(NFT_MARKETPLACE_PATH)
    })

    it("calls ListNFT with correct args", () => {
        const msg = buildListForSaleV3Msg(CALLER, COLLECTION_ID, TOKEN_ID, PRICE)
        expect(msg.value.func).toBe("ListNFT")
        expect(msg.value.args).toEqual([COLLECTION_ID, TOKEN_ID, String(PRICE)])
    })

    it("has empty send", () => {
        const msg = buildListForSaleV3Msg(CALLER, COLLECTION_ID, TOKEN_ID, PRICE)
        expect(msg.value.send).toBe("")
    })

    it("sets caller correctly", () => {
        const msg = buildListForSaleV3Msg(CALLER, COLLECTION_ID, TOKEN_ID, PRICE)
        expect(msg.value.caller).toBe(CALLER)
    })
})

// ── 2. buildBuyNFTV3Msg ───────────────────────────────────────

describe("buildBuyNFTV3Msg", () => {
    it("targets memba_nft_market_v3", () => {
        const msg = buildBuyNFTV3Msg(CALLER, COLLECTION_ID, TOKEN_ID, PRICE)
        expect(msg.value.pkg_path).toBe(NFT_MARKETPLACE_V3_PATH)
    })

    it("calls BuyNFT with correct args", () => {
        const msg = buildBuyNFTV3Msg(CALLER, COLLECTION_ID, TOKEN_ID, PRICE)
        expect(msg.value.func).toBe("BuyNFT")
        expect(msg.value.args).toEqual([COLLECTION_ID, TOKEN_ID])
    })

    it("sends price as ugnot", () => {
        const msg = buildBuyNFTV3Msg(CALLER, COLLECTION_ID, TOKEN_ID, PRICE)
        expect(msg.value.send).toBe(`${PRICE}ugnot`)
    })
})

// ── 3. buildDelistV3Msg ───────────────────────────────────────

describe("buildDelistV3Msg", () => {
    it("targets memba_nft_market_v3", () => {
        const msg = buildDelistV3Msg(CALLER, COLLECTION_ID, TOKEN_ID)
        expect(msg.value.pkg_path).toBe(NFT_MARKETPLACE_V3_PATH)
    })

    it("calls DelistNFT with correct args", () => {
        const msg = buildDelistV3Msg(CALLER, COLLECTION_ID, TOKEN_ID)
        expect(msg.value.func).toBe("DelistNFT")
        expect(msg.value.args).toEqual([COLLECTION_ID, TOKEN_ID])
    })

    it("has empty send", () => {
        const msg = buildDelistV3Msg(CALLER, COLLECTION_ID, TOKEN_ID)
        expect(msg.value.send).toBe("")
    })
})

// ── 4. buildMakeOfferV3Msg ────────────────────────────────────

describe("buildMakeOfferV3Msg", () => {
    it("targets memba_nft_market_v3", () => {
        const msg = buildMakeOfferV3Msg(CALLER, COLLECTION_ID, TOKEN_ID, OFFER)
        expect(msg.value.pkg_path).toBe(NFT_MARKETPLACE_V3_PATH)
    })

    it("calls MakeOffer with correct args", () => {
        const msg = buildMakeOfferV3Msg(CALLER, COLLECTION_ID, TOKEN_ID, OFFER)
        expect(msg.value.func).toBe("MakeOffer")
        expect(msg.value.args).toEqual([COLLECTION_ID, TOKEN_ID])
    })

    it("sends offer amount as ugnot", () => {
        const msg = buildMakeOfferV3Msg(CALLER, COLLECTION_ID, TOKEN_ID, OFFER)
        expect(msg.value.send).toBe(`${OFFER}ugnot`)
    })
})

// ── 5. buildCancelOfferV3Msg ──────────────────────────────────

describe("buildCancelOfferV3Msg", () => {
    it("targets memba_nft_market_v3", () => {
        const msg = buildCancelOfferV3Msg(CALLER, COLLECTION_ID, TOKEN_ID)
        expect(msg.value.pkg_path).toBe(NFT_MARKETPLACE_V3_PATH)
    })

    it("calls CancelOffer with correct args", () => {
        const msg = buildCancelOfferV3Msg(CALLER, COLLECTION_ID, TOKEN_ID)
        expect(msg.value.func).toBe("CancelOffer")
        expect(msg.value.args).toEqual([COLLECTION_ID, TOKEN_ID])
    })

    it("has empty send", () => {
        const msg = buildCancelOfferV3Msg(CALLER, COLLECTION_ID, TOKEN_ID)
        expect(msg.value.send).toBe("")
    })
})

// ── 6. buildAcceptOfferV3Msg ──────────────────────────────────

describe("buildAcceptOfferV3Msg", () => {
    it("targets memba_nft_market_v3", () => {
        const msg = buildAcceptOfferV3Msg(CALLER, COLLECTION_ID, TOKEN_ID, BUYER_ADDR)
        expect(msg.value.pkg_path).toBe(NFT_MARKETPLACE_V3_PATH)
    })

    it("calls AcceptOffer with correct args including buyer", () => {
        const msg = buildAcceptOfferV3Msg(CALLER, COLLECTION_ID, TOKEN_ID, BUYER_ADDR)
        expect(msg.value.func).toBe("AcceptOffer")
        expect(msg.value.args).toEqual([COLLECTION_ID, TOKEN_ID, BUYER_ADDR])
    })

    it("has empty send", () => {
        const msg = buildAcceptOfferV3Msg(CALLER, COLLECTION_ID, TOKEN_ID, BUYER_ADDR)
        expect(msg.value.send).toBe("")
    })
})

// ── 7. buildClaimExpiredOfferV3Msg ────────────────────────────

describe("buildClaimExpiredOfferV3Msg", () => {
    it("targets memba_nft_market_v3", () => {
        const msg = buildClaimExpiredOfferV3Msg(CALLER, COLLECTION_ID, TOKEN_ID, BUYER_ADDR)
        expect(msg.value.pkg_path).toBe(NFT_MARKETPLACE_V3_PATH)
    })

    it("calls ClaimExpiredOffer with correct 3-arg shape (collectionID, tokenId, buyer)", () => {
        const msg = buildClaimExpiredOfferV3Msg(CALLER, COLLECTION_ID, TOKEN_ID, BUYER_ADDR)
        expect(msg.value.func).toBe("ClaimExpiredOffer")
        expect(msg.value.args).toEqual([COLLECTION_ID, TOKEN_ID, BUYER_ADDR])
    })

    it("has empty send", () => {
        const msg = buildClaimExpiredOfferV3Msg(CALLER, COLLECTION_ID, TOKEN_ID, BUYER_ADDR)
        expect(msg.value.send).toBe("")
    })
})

// ── 8. buildSetApprovalForAllV3Msg ────────────────────────────

describe("buildSetApprovalForAllV3Msg — targets memba_collections (NOT the market)", () => {
    it("targets memba_collections (NFT_COLLECTIONS_PATH)", () => {
        const msg = buildSetApprovalForAllV3Msg(CALLER, COLLECTION_ID, NFT_MARKET_V3_ADDR, true)
        expect(msg.value.pkg_path).toBe(NFT_COLLECTIONS_PATH)
    })

    it("does NOT target the v3 market path", () => {
        const msg = buildSetApprovalForAllV3Msg(CALLER, COLLECTION_ID, NFT_MARKET_V3_ADDR, true)
        expect(msg.value.pkg_path).not.toBe(NFT_MARKETPLACE_V3_PATH)
    })

    it("calls SetApprovalForAll with correct args (approved=true)", () => {
        const msg = buildSetApprovalForAllV3Msg(CALLER, COLLECTION_ID, NFT_MARKET_V3_ADDR, true)
        expect(msg.value.func).toBe("SetApprovalForAll")
        expect(msg.value.args).toEqual([COLLECTION_ID, NFT_MARKET_V3_ADDR, "true"])
    })

    it("calls SetApprovalForAll with correct args (approved=false)", () => {
        const msg = buildSetApprovalForAllV3Msg(CALLER, COLLECTION_ID, NFT_MARKET_V3_ADDR, false)
        expect(msg.value.args).toEqual([COLLECTION_ID, NFT_MARKET_V3_ADDR, "false"])
    })

    it("has empty send", () => {
        const msg = buildSetApprovalForAllV3Msg(CALLER, COLLECTION_ID, NFT_MARKET_V3_ADDR, true)
        expect(msg.value.send).toBe("")
    })

    it("uses NFT_MARKET_V3_ADDR as operator when approving the v3 market", () => {
        const msg = buildSetApprovalForAllV3Msg(CALLER, COLLECTION_ID, NFT_MARKET_V3_ADDR, true)
        expect((msg.value.args as string[])[1]).toBe(NFT_MARKET_V3_ADDR)
    })
})

// ── 9. tradeEngineFor ─────────────────────────────────────────

describe("tradeEngineFor", () => {
    it('tradeEngineFor("v2") returns v2 market path', () => {
        const ep = tradeEngineFor("v2")
        expect(ep.marketPath).toBe(NFT_MARKETPLACE_PATH)
    })

    it('tradeEngineFor("v2") returns v2 market addr', () => {
        const ep = tradeEngineFor("v2")
        expect(ep.marketAddr).toBe(NFT_MARKET_ADDR)
    })

    it('tradeEngineFor("v2") returns 250 bps fee', () => {
        const ep = tradeEngineFor("v2")
        expect(ep.feeBps).toBe(PLATFORM_FEE_BPS_V2)
        expect(ep.feeBps).toBe(250)
    })

    it('tradeEngineFor("v2") returns engine tag "v2"', () => {
        const ep = tradeEngineFor("v2")
        expect(ep.engine).toBe("v2")
    })

    it('tradeEngineFor("v3") returns v3 market path', () => {
        const ep = tradeEngineFor("v3")
        expect(ep.marketPath).toBe(NFT_MARKETPLACE_V3_PATH)
    })

    it('tradeEngineFor("v3") returns v3 market addr', () => {
        const ep = tradeEngineFor("v3")
        expect(ep.marketAddr).toBe(NFT_MARKET_V3_ADDR)
    })

    it('tradeEngineFor("v3") returns memba_collections as collectionPath', () => {
        const ep = tradeEngineFor("v3")
        expect(ep.collectionPath).toBe(NFT_COLLECTIONS_PATH)
    })

    it('tradeEngineFor("v3") returns 200 bps fee', () => {
        const ep = tradeEngineFor("v3")
        expect(ep.feeBps).toBe(PLATFORM_FEE_BPS_V3)
        expect(ep.feeBps).toBe(200)
    })

    it('tradeEngineFor("v3") returns engine tag "v3"', () => {
        const ep = tradeEngineFor("v3")
        expect(ep.engine).toBe("v3")
    })

    it('tradeEngineFor("v2") collectionPath is memba_nft_v2 collection path', () => {
        const ep = tradeEngineFor("v2")
        // v2 collection path is the NFT_COLLECTION_PATH (memba_nft_v2)
        expect(ep.collectionPath).toContain("memba_nft_v2")
    })
})
