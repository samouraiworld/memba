/**
 * The market realm's listing calls as Memba signs them: buying a listing
 * priced in GNOT, and a seller cancelling its own listing. Buy names the
 * currency and price the buyer read, so a listing on other terms takes
 * nothing. Listings priced in a token need that token's own approval call:
 * Memba does not buy them yet, and says so.
 *
 * @module lib/nft/trade
 */
import { depositCapUgnot } from "../dao/v2Budget"
import type { LaunchpadActionStatus } from "../tokenLaunchpadConfigClient"
import type { AminoMsg } from "../grc20"
import { NFT_MARKET_PATH, type NftListing } from "./market"
import { address } from "./parse"

const NATIVE = "ugnot"

/** About twice the measured gas (Buy 25.2M, Cancel 12.4M on pinned Gno e75fef8), as for every Launchpad call. */
export const BUY_GAS_WANTED = 50_000_000
export const CANCEL_LISTING_GAS_WANTED = 25_000_000

/**
 * A sale frees the listing (7,751 bytes measured, its deposit to the buyer) and adds the
 * token to the buyer's holdings (up to 3.9 KB measured for a transfer); the
 * cap is twice that. A cancel only frees bytes.
 */
export const BUY_STORAGE_BYTES = 4_000
export const CANCEL_LISTING_STORAGE_BYTES = 500

/** Why a Launchpad lane takes no new action now (config's ActionStatusJSON), in one sentence; empty when it is open. */
export function laneClosedReason(status: Pick<LaunchpadActionStatus, "open" | "paused" | "allowlisted">, action: string): string {
    if (status.open) return ""
    if (status.paused) return `${action} is paused on this network for now.`
    if (!status.allowlisted) return `${action} in this currency is not allowed on this network.`
    return `${action} is not set up on this network yet.`
}

/** Why `viewer` cannot buy this listing in Memba now; empty when it can. A guest can: it is asked to connect. */
export function buyBlocker(listing: NftListing, viewer: string): string {
    if (viewer !== "" && viewer === listing.seller) return "This is your listing."
    if (!listing.buyable) return "This listing cannot be bought now."
    if (listing.currency !== NATIVE) return "Buying in a token arrives in a later version of Memba OS."
    return ""
}

const call = (caller: string, func: string, args: string[], send: string, storageBytes: number): AminoMsg => ({
    type: "vm/MsgCall",
    value: { caller: address(caller, "account"), send, pkg_path: NFT_MARKET_PATH, func, args, max_deposit: `${depositCapUgnot(storageBytes)}${NATIVE}` },
})

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
