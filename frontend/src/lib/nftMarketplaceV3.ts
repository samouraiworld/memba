/**
 * NFT Marketplace v3 MsgCall builders.
 *
 * Targets `memba_nft_market_v3` (v3 engine) and `memba_collections` registry.
 * The v3 ABI arg shapes are identical to v2 — only pkg_path, approval target,
 * and fee (200 bps vs 250 bps) differ.
 *
 * Approval flow:
 *   SetApprovalForAll → memba_collections (NOT the market)
 *   operator = NFT_MARKET_V3_ADDR
 *
 * @module lib/nftMarketplaceV3
 */

import type { AminoMsg } from "./grc20"
import { NFT_MARKETPLACE_V3_PATH, NFT_COLLECTIONS_PATH } from "./nftConfig"

// ── MsgCall Builders — Marketplace (memba_nft_market_v3) ─────

/**
 * Build MsgCall for ListNFT(collectionID, tid, price).
 * Caller must have SetApprovalForAll or Approve on memba_collections first.
 */
export function buildListForSaleV3Msg(
    caller: string,
    collectionID: string,
    tokenId: string,
    priceUgnot: number,
): AminoMsg {
    return {
        type: "vm/MsgCall",
        value: {
            caller,
            send: "",
            pkg_path: NFT_MARKETPLACE_V3_PATH,
            func: "ListNFT",
            args: [collectionID, tokenId, String(priceUgnot)],
        },
    }
}

/**
 * Build MsgCall for BuyNFT(collectionID, tid).
 * Sends the price amount in ugnot as payment.
 */
export function buildBuyNFTV3Msg(
    caller: string,
    collectionID: string,
    tokenId: string,
    priceUgnot: number,
): AminoMsg {
    return {
        type: "vm/MsgCall",
        value: {
            caller,
            send: `${priceUgnot}ugnot`,
            pkg_path: NFT_MARKETPLACE_V3_PATH,
            func: "BuyNFT",
            args: [collectionID, tokenId],
        },
    }
}

/**
 * Build MsgCall for DelistNFT(collectionID, tid).
 */
export function buildDelistV3Msg(
    caller: string,
    collectionID: string,
    tokenId: string,
): AminoMsg {
    return {
        type: "vm/MsgCall",
        value: {
            caller,
            send: "",
            pkg_path: NFT_MARKETPLACE_V3_PATH,
            func: "DelistNFT",
            args: [collectionID, tokenId],
        },
    }
}

/**
 * Build MsgCall for MakeOffer(collectionID, tid).
 * Sends the offer amount in ugnot (held in escrow).
 */
export function buildMakeOfferV3Msg(
    caller: string,
    collectionID: string,
    tokenId: string,
    offerAmountUgnot: number,
): AminoMsg {
    return {
        type: "vm/MsgCall",
        value: {
            caller,
            send: `${offerAmountUgnot}ugnot`,
            pkg_path: NFT_MARKETPLACE_V3_PATH,
            func: "MakeOffer",
            args: [collectionID, tokenId],
        },
    }
}

/**
 * Build MsgCall for CancelOffer(collectionID, tid).
 * Returns escrowed funds to the offerer.
 */
export function buildCancelOfferV3Msg(
    caller: string,
    collectionID: string,
    tokenId: string,
): AminoMsg {
    return {
        type: "vm/MsgCall",
        value: {
            caller,
            send: "",
            pkg_path: NFT_MARKETPLACE_V3_PATH,
            func: "CancelOffer",
            args: [collectionID, tokenId],
        },
    }
}

/**
 * Build MsgCall for AcceptOffer(collectionID, tid, buyer) — seller action.
 */
export function buildAcceptOfferV3Msg(
    caller: string,
    collectionID: string,
    tokenId: string,
    buyerAddr: string,
): AminoMsg {
    return {
        type: "vm/MsgCall",
        value: {
            caller,
            send: "",
            pkg_path: NFT_MARKETPLACE_V3_PATH,
            func: "AcceptOffer",
            args: [collectionID, tokenId, buyerAddr],
        },
    }
}

/**
 * Build MsgCall for ClaimExpiredOffer(collectionID, tid, buyer) — reclaim funds after expiry.
 * NOTE: v3 adds tokenId as the second arg (v2 omits it).
 */
export function buildClaimExpiredOfferV3Msg(
    caller: string,
    collectionID: string,
    tokenId: string,
    buyerAddr: string,
): AminoMsg {
    return {
        type: "vm/MsgCall",
        value: {
            caller,
            send: "",
            pkg_path: NFT_MARKETPLACE_V3_PATH,
            func: "ClaimExpiredOffer",
            args: [collectionID, tokenId, buyerAddr],
        },
    }
}

// ── MsgCall Builders — Collection (memba_collections) ────────

/**
 * Build MsgCall for SetApprovalForAll(collectionID, operator, approved).
 * pkg_path = memba_collections (NOT the marketplace).
 * Use NFT_MARKET_V3_ADDR as operatorAddr to approve the v3 market.
 */
export function buildSetApprovalForAllV3Msg(
    caller: string,
    collectionID: string,
    operatorAddr: string,
    approved: boolean,
): AminoMsg {
    return {
        type: "vm/MsgCall",
        value: {
            caller,
            send: "",
            pkg_path: NFT_COLLECTIONS_PATH,
            func: "SetApprovalForAll",
            args: [collectionID, operatorAddr, String(approved)],
        },
    }
}
