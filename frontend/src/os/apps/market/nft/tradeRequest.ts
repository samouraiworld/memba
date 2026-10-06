/**
 * Listing a token, buying a listing and cancelling one's own go through the
 * OS review sheet. The sheet shows what was read when the member asked; right
 * before the wallet opens it is read again, and any change to the terms stops
 * the signature. Cancelling never asks the market lane: a seller can always
 * withdraw, paused market or not.
 *
 * @module os/apps/market/nft/tradeRequest
 */
import { isNftEnabled, isRealmValidOn } from "../../../../lib/config"
import { isValidGnoAddressChecksum } from "../../../../lib/dao/address"
import { depositCapUgnot, formatUgnot, formatUgnotExact } from "../../../../lib/dao/v2Budget"
import { assertFeeStillCovers, doContractBroadcast, feeForGasWanted, freshFeeForGasWanted, type GasPrice } from "../../../../lib/grc20"
import { formatAmount, formatBPS } from "../../../../lib/nft/format"
import { NFT_LEDGER_PATH, getToken } from "../../../../lib/nft/ledger"
import { NFT_MARKET_PATH, getListing, getMarketTerms, getTokenListing, type NftListing, type NftSplit } from "../../../../lib/nft/market"
import {
    APPROVE_STORAGE_BYTES, BUY_GAS_WANTED, BUY_STORAGE_BYTES, CANCEL_LISTING_GAS_WANTED, LIST_GAS_WANTED, LIST_STORAGE_BYTES,
    buildBuyMsg, buildCancelListingMsg, buildListMsgs, buyBlocker,
} from "../../../../lib/nft/trade"
import { laneClosedReason, readActionStatus } from "../../../../lib/tokenLaunchpadConfigClient"
import type { SettledOutcome, SignRequest } from "../../../sign/signer"
import { verifySendTx } from "../../../wallet/sendRequest"
import { ORDER_DEPOSIT, utc } from "./reads"

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

export function available(draft: { networkKey: string; caller: string }): void {
    if (!isNftEnabled() || !isRealmValidOn(draft.networkKey, NFT_MARKET_PATH)) throw new Error("The NFT market is not available on this network.")
    if (!isValidGnoAddressChecksum(draft.caller)) throw new Error("Connect your wallet first.")
}

export const sameSplit = (a: NftSplit, b: NftSplit) => a.seller === b.seller && a.fee === b.fee && a.royalties.length === b.royalties.length &&
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

/** Who the price goes to, line by line, as the realm computed it. */
export function payouts(order: { split: NftSplit; feeBPS: bigint; currency: string }): [string, string][] {
    const amount = (value: bigint) => formatAmount(value, order.currency)
    return [
        ["To the seller", amount(order.split.seller)],
        [`Protocol fee (${formatBPS(order.feeBPS)})`, amount(order.split.fee)],
        ...order.split.royalties.map((royalty): [string, string] => [`Royalty to ${royalty.account}`, amount(royalty.amount)]),
    ]
}

export interface ListDraft {
    collection: string
    number: bigint
    /** In ugnot. */
    price: bigint
    expiresAt: bigint
    /** The protocol fee in force and the split it gives, as read when the member asked. */
    feeBPS: bigint
    split: NftSplit
    /** The token's open listing, whoever listed it, which this one replaces (the market keeps one per token). */
    replaces: string | null
    caller: string
    networkKey: string
    chainId: string
    gas: GasPrice
    onSettled?: (outcome: SettledOutcome) => void
}

export function listRequest(draft: ListDraft): SignRequest {
    available(draft)
    const msgs = buildListMsgs(draft.caller, { ...draft, maxFeeBPS: draft.feeBPS })
    const fee = feeForGasWanted(LIST_GAS_WANTED, draft.gas)
    const token = `${draft.collection} #${draft.number}`
    const order = { split: draft.split, feeBPS: draft.feeBPS, currency: "ugnot" }
    return {
        title: "List for sale",
        summary: `List ${token} for ${formatAmount(draft.price, "ugnot")}`,
        sub: draft.replaces ? `Replaces listing ${draft.replaces}` : "A new listing",
        lines: () => [
            ["Account", draft.caller],
            ["Token", token],
            ["Price", formatAmount(draft.price, "ugnot")],
            ...payouts(order).map(([to, amount]): [string, string] => [`At a sale: ${to.charAt(0).toLowerCase()}${to.slice(1)}`, amount]),
            ["Expires", utc(draft.expiresAt)],
            ...(draft.replaces ? [["Replaces", `Listing ${draft.replaces}, closed by this one`] as [string, string]] : []),
            ["Approval", `The market may move this one token, through a sale only; it lapses when the token moves`],
            ["Realms", `${NFT_LEDGER_PATH}, then ${NFT_MARKET_PATH}`],
            ["Network", draft.chainId],
            ["Storage deposit", `Up to ${formatUgnot(depositCapUgnot(APPROVE_STORAGE_BYTES) + depositCapUgnot(LIST_STORAGE_BYTES))}; the listing's part (${ORDER_DEPOSIT}) goes to whoever closes it`],
            ["Network fee", formatUgnotExact(fee)],
        ],
        note: "The token stays in your account until someone buys it. You can cancel the listing at any time, paused market or not. A listing does not move the token by itself: if you transfer it, the listing can no longer be bought.",
        label: () => `List ${token}`,
        prepare: () => ({ msgs }),
        recheck: async () => {
            available(draft)
            if (draft.expiresAt * 1000n <= BigInt(Date.now()) + 60_000n) throw new Error("This listing's expiry has passed. Nothing was sent. Close the review and list again.")
            const lane = await readActionStatus(draft.networkKey, "nft_market", "ugnot")
            if (!lane.open) throw new Error(`${laneClosedReason(lane, "Trading")} Nothing was sent.`)
            const held = await getToken(draft.collection, draft.number)
            if (held.status !== "active" || held.owner !== draft.caller) throw new Error(`This account no longer holds ${token}. Nothing was sent.`)
            const current = await getTokenListing(draft.collection, draft.number)
            if ((current?.id ?? null) !== draft.replaces) throw new Error(`The open listing of ${token} changed after your review. Nothing was sent. Close the review and list again.`)
            const terms = await getMarketTerms(draft.collection, draft.price)
            if (terms.feeBPS !== draft.feeBPS || terms.split === null || !sameSplit(terms.split, draft.split)) throw new Error("The market's terms changed after your review. Nothing was sent. Close the review and read them again.")
            await assertFeeStillCovers(fee, () => freshFeeForGasWanted(LIST_GAS_WANTED))
        },
        send: (_choice, beforeSign) => doContractBroadcast(msgs, `List ${token}`, { gasWanted: LIST_GAS_WANTED, gasFee: fee, beforeSign }),
        verify: (_choice, hash) => verifySendTx(hash),
        onSettled: draft.onSettled,
    }
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
            ["Storage deposit", `Up to ${formatUgnot(depositCapUgnot(BUY_STORAGE_BYTES))} for the token in your holdings; the listing's own deposit is paid to you`],
            ["Network fee", formatUgnotExact(fee)],
        ],
        note: "The token and the payment move in the same transaction: either both happen or neither does. The price is not refunded.",
        label: () => `Buy ${token}`,
        prepare: () => ({ msgs: [msg] }),
        recheck: async () => {
            available(draft)
            const lane = await readActionStatus(draft.networkKey, "nft_market", listing.currency)
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
            ["Storage deposit", `The listing's deposit (${ORDER_DEPOSIT}) comes back to you`],
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
