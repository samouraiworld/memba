/**
 * router.ts — the multi-engine trade router.
 *
 * One entry point the shell + lane panels call to turn a (listing, action) into the
 * MsgCall(s) to broadcast. It does two things:
 *   1. SAFETY — asserts the listing's engine is allowlisted on the active network
 *      before building any tx (the trade-builder-call-site guard from the frontend
 *      review; complements W0.1's page gate so a write can never target an
 *      un-allowlisted engine, which the broadcast layer doesn't check).
 *   2. DISPATCH — routes by assetType + action to that lane's builders.
 *
 * v1 wires the NFT lane; service/token/agent throw until their waves (W2 / v1.1 / v1.2).
 *
 * @module lib/marketplace/router
 */

import type { AminoMsg } from "../grc20"
import { isRealmValid } from "../config"
import { NFT_MARKETPLACE_V3_PATH } from "../nftConfig"
import {
    buildBuyNFTV3Msg,
    buildListForSaleV3Msg,
    buildDelistV3Msg,
    buildMakeOfferV3Msg,
    buildCancelOfferV3Msg,
    buildAcceptOfferV3Msg,
    buildSetApprovalForAllV3Msg,
} from "../nftMarketplaceV3"
import { isNftListing, type UnifiedListing, type UnifiedNft } from "./types"

/** Every action the router can route, across lanes. */
export type TradeAction =
    | "buy"
    | "list"
    | "offer"
    | "delist"
    | "cancel-offer"
    | "accept"

export interface RouteParams {
    listing: UnifiedListing
    action: TradeAction
    caller: string
    /** Price (buy/list) or offer amount, in ugnot. Required for buy/list/offer. */
    amountUgnot?: number
    /** Buyer address — required for `accept` (seller accepting an offer). */
    buyerAddr?: string
}

/** Split a UnifiedNft id ("collectionID/tokenId", where collectionID may contain a
 *  slash, e.g. "creator/slug") into its parts. tokenId is the last segment. */
function splitNftId(id: string): { collectionID: string; tokenId: string } {
    const i = id.lastIndexOf("/")
    if (i <= 0 || i === id.length - 1) {
        throw new Error(`invalid nft listing id: ${id}`)
    }
    return { collectionID: id.slice(0, i), tokenId: id.slice(i + 1) }
}

function requireAmount(amountUgnot: number | undefined, action: string): number {
    if (amountUgnot === undefined || !Number.isFinite(amountUgnot) || amountUgnot <= 0) {
        throw new Error(`action "${action}" requires a positive amountUgnot`)
    }
    return amountUgnot
}

/** Low-level NFT (v3) dispatch by explicit collection/token — the reusable core that
 *  both routeTrade (UnifiedListing) and the trade panels call. Carries the engine
 *  allowlist guard so neither path can build a tx against an un-allowlisted v3 engine. */
export interface NftV3RouteParams {
    collectionID: string
    tokenId: string
    action: TradeAction
    caller: string
    amountUgnot?: number
    buyerAddr?: string
}

export function routeNftV3(p: NftV3RouteParams): AminoMsg[] {
    if (!isRealmValid(NFT_MARKETPLACE_V3_PATH)) {
        throw new Error(`engine not available on this network: ${NFT_MARKETPLACE_V3_PATH}`)
    }
    const { collectionID, tokenId, caller, action } = p
    switch (action) {
        case "buy":
            return [buildBuyNFTV3Msg(caller, collectionID, tokenId, requireAmount(p.amountUgnot, action))]
        case "list":
            return [buildListForSaleV3Msg(caller, collectionID, tokenId, requireAmount(p.amountUgnot, action))]
        case "offer":
            return [buildMakeOfferV3Msg(caller, collectionID, tokenId, requireAmount(p.amountUgnot, action))]
        case "delist":
            return [buildDelistV3Msg(caller, collectionID, tokenId)]
        case "cancel-offer":
            return [buildCancelOfferV3Msg(caller, collectionID, tokenId)]
        case "accept": {
            if (!p.buyerAddr) throw new Error('action "accept" requires buyerAddr')
            return [buildAcceptOfferV3Msg(caller, collectionID, tokenId, p.buyerAddr)]
        }
        default:
            throw new Error(`unsupported nft action: ${action}`)
    }
}

function routeNft(listing: UnifiedNft, p: RouteParams): AminoMsg[] {
    const { collectionID, tokenId } = splitNftId(listing.id)
    return routeNftV3({
        collectionID,
        tokenId,
        action: p.action,
        caller: p.caller,
        amountUgnot: p.amountUgnot,
        buyerAddr: p.buyerAddr,
    })
}

/**
 * Build the approval tx the seller must broadcast before listing an NFT
 * (SetApprovalForAll on the registry, operator = the engine address). Separate from
 * routeTrade because the panel only sends it when isApprovedForAll is false.
 */
export function buildNftApproval(listing: UnifiedNft, caller: string): AminoMsg {
    const { collectionID } = splitNftId(listing.id)
    return buildSetApprovalForAllV3Msg(caller, collectionID, listing.engine.addr, true)
}

/**
 * Route a (listing, action) to the MsgCall(s) to broadcast. Throws if the engine is
 * not allowlisted on the active network, or the lane/action is not wired yet.
 */
export function routeTrade(p: RouteParams): AminoMsg[] {
    if (!isRealmValid(p.listing.engine.path)) {
        throw new Error(`engine not available on this network: ${p.listing.engine.path}`)
    }
    if (isNftListing(p.listing)) {
        return routeNft(p.listing, p)
    }
    throw new Error(`lane "${p.listing.assetType}" is not wired yet`)
}
