/**
 * The market realm's order calls as Memba signs them, all in GNOT: listing a
 * token, buying a listing, a seller cancelling its own listing, making an
 * offer on a token or a collection, cancelling one's own offer, and a holder
 * accepting an offer. Buy and AcceptOffer name the currency and price the
 * caller read, so an order on other terms takes nothing; List and MakeOffer
 * name the highest protocol fee the caller accepts. Orders priced in a token
 * need that token's own approval call, and trait offers need a proof built
 * from the creator's trait list: Memba does not handle either yet, and says so.
 *
 * @module lib/nft/trade
 */
import { depositCapUgnot } from "../dao/v2Budget"
import type { AminoMsg } from "../grc20"
import { NFT_LEDGER_PATH } from "./ledger"
import { NFT_MARKET_PATH, type NftListing, type NftOffer } from "./market"
import { address, collectionId, tokenNumber } from "./parse"
import { natural } from "./read"

const NATIVE = "ugnot"

/*
 * Gas limits: at least twice the most each transaction was measured to use, as for every
 * Launchpad call, since a live chain's trees and keys differ from a test node's (gas.test.ts
 * lists the measurements: Buy 33.2M, Cancel 12.5M, Approve 13.0M + List 17.5M, MakeOffer up
 * to 18.1M, CancelOffer 10.5M, Approve 13.0M + AcceptOffer 33.1M; a sale pays up to ten
 * royalty receivers).
 */
export const BUY_GAS_WANTED = 67_000_000
export const CANCEL_LISTING_GAS_WANTED = 26_000_000
/** Approve and List in one transaction. */
export const LIST_GAS_WANTED = 62_000_000
export const MAKE_OFFER_GAS_WANTED = 37_000_000
export const CANCEL_OFFER_GAS_WANTED = 21_000_000
/** Approve and AcceptOffer in one transaction. */
export const ACCEPT_OFFER_GAS_WANTED = 93_000_000

/** The market realm's address, derived from its path: the account a seller approves for one token. */
export const NFT_MARKET_ADDRESS = "g1nn54k5fmly8agexe3ll4t6clqmcefsn7nr9ee3"

/** How long a new listing stays open, in days; the realm refuses more than 90. */
export const LISTING_DAYS = [1, 7, 30, 90] as const
export type ListingDays = (typeof LISTING_DAYS)[number]

/**
 * When a listing made at `nowSeconds` for `days` expires. The longest is an
 * hour short of 90 days, so a block a little later than this clock still
 * accepts it.
 */
export function listingExpiry(nowSeconds: number, days: ListingDays): bigint {
    return BigInt(Math.floor(nowSeconds) + days * 86_400 - (days === 90 ? 3_600 : 0))
}

/**
 * A sale frees the listing (7,751 bytes measured, its deposit to the buyer) and adds the
 * token to the buyer's holdings (up to 3.9 KB measured for a transfer); the
 * cap is twice that. A cancel only frees bytes.
 */
export const BUY_STORAGE_BYTES = 4_000
export const CANCEL_LISTING_STORAGE_BYTES = 500
/** Each message has its own cap, twice its bytes: the approval (up to 2,118 bytes measured) and the listing (7,790 bytes measured, all freed when it closes). */
export const APPROVE_STORAGE_BYTES = 2_200
export const LIST_STORAGE_BYTES = 7_800
/** An open offer holds 7,813 bytes (measured), all freed when it closes; an accepted one adds the token to the buyer's holdings. */
export const OFFER_STORAGE_BYTES = 7_900
export const CANCEL_OFFER_STORAGE_BYTES = 500
export const ACCEPT_OFFER_STORAGE_BYTES = 4_000

/** Why `viewer` cannot buy this listing in Memba now; empty when it can. A guest can: it is asked to connect. */
export function buyBlocker(listing: NftListing, viewer: string): string {
    if (viewer !== "" && viewer === listing.seller) return "This is your listing."
    if (!listing.buyable) return "This listing cannot be bought now."
    if (listing.currency !== NATIVE) return "Buying in a token arrives in a later version of Memba OS."
    return ""
}

const call = (caller: string, func: string, args: string[], send: string, storageBytes: number, pkgPath = NFT_MARKET_PATH): AminoMsg => ({
    type: "vm/MsgCall",
    value: { caller: address(caller, "account"), send, pkg_path: pkgPath, func, args, max_deposit: `${depositCapUgnot(storageBytes)}${NATIVE}` },
})

export interface ListTerms {
    collection: string
    number: bigint
    /** In ugnot. */
    price: bigint
    expiresAt: bigint
    /** The protocol fee the seller read and accepts; the realm pins the fee in force, never more. */
    maxFeeBPS: bigint
}

/**
 * The ledger's Approve(id, market, number), then List(collection, number,
 * price, expiresAt, "ugnot", maxFeeBPS): one transaction, so the market is
 * never approved for a token that did not get listed. Only a single-token
 * approval lets the market sell, and the ledger clears it when the token moves.
 */
export function buildListMsgs(caller: string, terms: ListTerms): AminoMsg[] {
    const id = collectionId(terms.collection)
    const number = tokenNumber(terms.number.toString())
    if (terms.price <= 0n) throw new Error("Set a price above zero.")
    const args = [id, number.toString(), natural(terms.price, "price").toString(), natural(terms.expiresAt, "expiry").toString(), NATIVE, natural(terms.maxFeeBPS, "maximum fee").toString()]
    return [
        call(caller, "Approve", [id, NFT_MARKET_ADDRESS, number.toString()], "", APPROVE_STORAGE_BYTES, NFT_LEDGER_PATH),
        call(caller, "List", args, "", LIST_STORAGE_BYTES),
    ]
}

/** Buy(id, currencyKey, price), with exactly the price attached. */
export function buildBuyMsg(caller: string, listing: NftListing): AminoMsg {
    const blocker = buyBlocker(listing, caller)
    if (blocker) throw new Error(blocker)
    return call(caller, "Buy", [listing.id, NATIVE, listing.price.toString()], `${listing.price}${NATIVE}`, BUY_STORAGE_BYTES)
}

/** Cancel(id): the seller withdraws its listing, paused market or not. */
export function buildCancelListingMsg(caller: string, listing: NftListing): AminoMsg {
    if (caller !== listing.seller) throw new Error("Only the seller can cancel this listing now.")
    return call(caller, "Cancel", [listing.id], "", CANCEL_LISTING_STORAGE_BYTES)
}

/** What Memba makes an offer for: one token, or any token of a collection. */
export type MadeOfferKind = "token" | "collection"

export interface OfferTerms {
    kind: MadeOfferKind
    collection: string
    /** The token of a token offer; 0 for a collection offer. */
    number: bigint
    /** In ugnot, escrowed by the market until the offer closes. */
    price: bigint
    expiresAt: bigint
    maxFeeBPS: bigint
}

/** MakeOffer(kind, collection, number, "", price, expiresAt, "ugnot", maxFeeBPS), with the price attached. */
export function buildMakeOfferMsg(caller: string, terms: OfferTerms): AminoMsg {
    const id = collectionId(terms.collection)
    const number = terms.kind === "token" ? tokenNumber(terms.number.toString()) : 0n
    if (terms.kind === "collection" && terms.number !== 0n) throw new Error("A collection offer names no token.")
    if (terms.price <= 0n) throw new Error("Set a price above zero.")
    const price = natural(terms.price, "price")
    return call(caller, "MakeOffer", [terms.kind, id, number.toString(), "", price.toString(), natural(terms.expiresAt, "expiry").toString(), NATIVE, natural(terms.maxFeeBPS, "maximum fee").toString()], `${price}${NATIVE}`, OFFER_STORAGE_BYTES)
}

/** CancelOffer(id): the buyer takes its escrow back, expired or not, paused market or not. */
export function buildCancelOfferMsg(caller: string, offer: NftOffer): AminoMsg {
    if (caller !== offer.buyer) throw new Error("Only the buyer can cancel this offer.")
    return call(caller, "CancelOffer", [offer.id], "", CANCEL_OFFER_STORAGE_BYTES)
}

/** Why `holder` cannot accept this offer for token `number` in Memba now; empty when it can. */
export function acceptBlocker(offer: NftOffer, number: bigint, holder: string): string {
    if (holder === offer.buyer) return "This is your offer."
    if (offer.kind === "trait") return "Accepting a trait offer arrives in a later version of Memba OS."
    if (offer.kind === "token" && offer.number !== number) return "This offer is for another token."
    if (offer.currency !== NATIVE) return "Accepting an offer in a token arrives in a later version of Memba OS."
    return ""
}

/**
 * The ledger's Approve(id, market, number), then AcceptOffer(id, number, "",
 * "ugnot", price): one transaction, so the market is never left approved for
 * a token that was not sold. The token's own listing, if any, closes with it.
 */
export function buildAcceptOfferMsgs(caller: string, offer: NftOffer, number: bigint): AminoMsg[] {
    const blocker = acceptBlocker(offer, number, caller)
    if (blocker) throw new Error(blocker)
    const token = tokenNumber(number.toString()).toString()
    return [
        call(caller, "Approve", [offer.collection, NFT_MARKET_ADDRESS, token], "", APPROVE_STORAGE_BYTES, NFT_LEDGER_PATH),
        call(caller, "AcceptOffer", [offer.id, token, "", NATIVE, offer.price.toString()], "", ACCEPT_OFFER_STORAGE_BYTES),
    ]
}
