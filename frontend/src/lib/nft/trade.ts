/**
 * The market realm's listing calls as Memba signs them: listing a token in
 * GNOT, buying a listing priced in GNOT, and a seller cancelling its own
 * listing. Buy names the currency and price the buyer read, so a listing on
 * other terms takes nothing; List names the highest protocol fee the seller
 * accepts. Listings priced in a token need that token's own approval call:
 * Memba does not buy them yet, and says so.
 *
 * @module lib/nft/trade
 */
import { depositCapUgnot } from "../dao/v2Budget"
import type { AminoMsg } from "../grc20"
import { NFT_LEDGER_PATH } from "./ledger"
import { NFT_MARKET_PATH, type NftListing } from "./market"
import { address, collectionId, tokenNumber } from "./parse"
import { natural } from "./read"

const NATIVE = "ugnot"

/** About twice the measured gas (Buy 25.2M, Cancel 12.4M on pinned Gno e75fef8), as for every Launchpad call. */
export const BUY_GAS_WANTED = 50_000_000
export const CANCEL_LISTING_GAS_WANTED = 25_000_000
/** Approve (9.3M) and List (15.7M) in one transaction. */
export const LIST_GAS_WANTED = 50_000_000

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
/** Each message has its own cap, twice its bytes: the approval (1.1 KB measured) and the listing (7,751 bytes measured, all freed when it closes). */
export const APPROVE_STORAGE_BYTES = 1_500
export const LIST_STORAGE_BYTES = 7_800

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
