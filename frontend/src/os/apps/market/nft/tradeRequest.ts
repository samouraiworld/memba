/**
 * Buying a listing and cancelling one's own go through the OS review sheet.
 * The sheet shows the listing as read when the member asked; right before the
 * wallet opens it is read again, and any change to its terms stops the
 * signature. Cancelling never asks the market lane: a seller can always
 * withdraw, paused market or not.
 *
 * @module os/apps/market/nft/tradeRequest
 */
import { isNftEnabled, isRealmValidOn } from "../../../../lib/config"
import { isValidGnoAddressChecksum } from "../../../../lib/dao/address"
import { depositCapUgnot, formatUgnot, formatUgnotExact } from "../../../../lib/dao/v2Budget"
import { assertFeeStillCovers, doContractBroadcast, feeForGasWanted, freshFeeForGasWanted, type GasPrice } from "../../../../lib/grc20"
import { formatAmount, formatBPS } from "../../../../lib/nft/format"
import { getLaneStatus, laneClosedReason } from "../../../../lib/nft/lane"
import { NFT_MARKET_PATH, getListing, type NftListing, type NftSplit } from "../../../../lib/nft/market"
import {
    BUY_GAS_WANTED, BUY_STORAGE_BYTES, CANCEL_LISTING_GAS_WANTED, buildBuyMsg, buildCancelListingMsg, buyBlocker,
} from "../../../../lib/nft/trade"
import type { SettledOutcome, SignRequest } from "../../../sign/signer"
import { verifySendTx } from "../../../wallet/sendRequest"

export interface ListingDraft {
    /** The listing as read when the member asked. */
    listing: NftListing
    caller: string
    networkKey: string
    chainId: string
    /** The network gas price, read from the chain when the sheet was asked for. */
    price: GasPrice
    onSettled?: (outcome: SettledOutcome) => void
}

function available(draft: ListingDraft): void {
    if (!isNftEnabled() || !isRealmValidOn(draft.networkKey, NFT_MARKET_PATH)) throw new Error("The NFT market is not available on this network.")
    if (!isValidGnoAddressChecksum(draft.caller)) throw new Error("Connect your wallet first.")
}

const sameSplit = (a: NftSplit, b: NftSplit) => a.seller === b.seller && a.fee === b.fee && a.royalties.length === b.royalties.length &&
    a.royalties.every((royalty, index) => royalty.account === b.royalties[index].account && royalty.amount === b.royalties[index].amount)

/** The listing read again is the one reviewed: still open, on the same terms, paid out the same way. */
async function assertSameListing(reviewed: NftListing): Promise<NftListing> {
    const read = await getListing(reviewed.id)
    if (read === null) throw new Error("This listing has closed. Nothing was sent.")
    const same = read.collection === reviewed.collection && read.number === reviewed.number && read.seller === reviewed.seller &&
        read.price === reviewed.price && read.currency === reviewed.currency && read.feeBPS === reviewed.feeBPS &&
        read.expiresAt === reviewed.expiresAt && sameSplit(read.split, reviewed.split)
    if (!same) throw new Error("This listing changed after your review. Nothing was sent. Close the review and read it again.")
    return read
}

/** Who the price goes to, line by line, as the realm computed it for this listing. */
function payouts(listing: NftListing): [string, string][] {
    const amount = (value: bigint) => formatAmount(value, listing.currency)
    return [
        ["To the seller", amount(listing.split.seller)],
        [`Protocol fee (${formatBPS(listing.feeBPS)})`, amount(listing.split.fee)],
        ...listing.split.royalties.map((royalty): [string, string] => [`Royalty to ${royalty.account}`, amount(royalty.amount)]),
    ]
}

export function buyRequest(draft: ListingDraft): SignRequest {
    available(draft)
    const { listing } = draft
    const msg = buildBuyMsg(draft.caller, listing)
    const fee = feeForGasWanted(BUY_GAS_WANTED, draft.price)
    const token = `${listing.collection} #${listing.number}`
    return {
        title: "Buy",
        summary: `Buy ${token} for ${formatAmount(listing.price, listing.currency)}`,
        sub: `Listing ${listing.id}`,
        lines: () => [
            ["Account", draft.caller],
            ["Token", token],
            ["Price", formatAmount(listing.price, listing.currency)],
            ...payouts(listing),
            ["Seller", listing.seller],
            ["Market realm", NFT_MARKET_PATH],
            ["Network", draft.chainId],
            ["Storage deposit", `Up to ${formatUgnot(depositCapUgnot(BUY_STORAGE_BYTES))} for the token in your holdings; the listing's own deposit comes back to you`],
            ["Network fee", formatUgnotExact(fee)],
        ],
        note: "The token and the payment move in the same transaction: either both happen or neither does. The price is not refunded.",
        label: () => `Buy ${token}`,
        prepare: () => ({ msgs: [msg] }),
        recheck: async () => {
            available(draft)
            const lane = await getLaneStatus("nft_market", listing.currency)
            if (!lane.open) throw new Error(`${laneClosedReason(lane, "Trading")} Nothing was sent.`)
            const read = await assertSameListing(listing)
            const blocker = buyBlocker(read, draft.caller)
            if (blocker) throw new Error(`${blocker} Nothing was sent.`)
            await assertFeeStillCovers(fee, () => freshFeeForGasWanted(BUY_GAS_WANTED))
        },
        send: (_choice, beforeSign) => doContractBroadcast([msg], `Buy ${token}`, { gasWanted: BUY_GAS_WANTED, gasFee: fee, beforeSign }),
        verify: (_choice, hash) => verifySendTx(hash),
        onSettled: draft.onSettled,
    }
}

export function cancelListingRequest(draft: ListingDraft): SignRequest {
    available(draft)
    const { listing } = draft
    const msg = buildCancelListingMsg(draft.caller, listing)
    const fee = feeForGasWanted(CANCEL_LISTING_GAS_WANTED, draft.price)
    const token = `${listing.collection} #${listing.number}`
    return {
        title: "Cancel listing",
        summary: `Withdraw ${token} from sale`,
        sub: `Listing ${listing.id} at ${formatAmount(listing.price, listing.currency)}`,
        lines: () => [
            ["Account", draft.caller],
            ["Token", token],
            ["Listing", `${listing.id}, ${formatAmount(listing.price, listing.currency)}`],
            ["Market realm", NFT_MARKET_PATH],
            ["Network", draft.chainId],
            ["Storage deposit", "The listing's deposit (about 0.78 GNOT) comes back to you"],
            ["Network fee", formatUgnotExact(fee)],
        ],
        note: "The token never left your account. After this it can no longer be bought through this listing.",
        label: () => `Cancel listing ${listing.id}`,
        prepare: () => ({ msgs: [msg] }),
        recheck: async () => {
            available(draft)
            const read = await getListing(listing.id)
            if (read === null) throw new Error("This listing has already closed. Nothing was sent.")
            if (read.seller !== draft.caller) throw new Error("Only the seller can cancel this listing now. Nothing was sent.")
            await assertFeeStillCovers(fee, () => freshFeeForGasWanted(CANCEL_LISTING_GAS_WANTED))
        },
        send: (_choice, beforeSign) => doContractBroadcast([msg], `Cancel listing ${listing.id}`, { gasWanted: CANCEL_LISTING_GAS_WANTED, gasFee: fee, beforeSign }),
        verify: (_choice, hash) => verifySendTx(hash),
        onSettled: draft.onSettled,
    }
}
