/**
 * Making an offer, cancelling one's own and accepting one go through the OS
 * review sheet. What the sheet shows is read again right before the wallet
 * opens, and any change stops the signature. Cancelling never asks the market
 * lane: a buyer can always take its escrow back.
 *
 * @module os/apps/market/nft/offerRequest
 */
import { depositCapUgnot, formatUgnot, formatUgnotExact } from "../../../../lib/dao/v2Budget"
import { assertFeeStillCovers, doContractBroadcast, feeForGasWanted, freshFeeForGasWanted, type GasPrice } from "../../../../lib/grc20"
import { formatAmount } from "../../../../lib/nft/format"
import { NFT_LEDGER_PATH, getToken } from "../../../../lib/nft/ledger"
import { NFT_MARKET_PATH, getMarketTerms, getOffer, getTokenListing, type NftOffer, type NftSplit } from "../../../../lib/nft/market"
import {
    ACCEPT_OFFER_GAS_WANTED, APPROVE_STORAGE_BYTES, ACCEPT_OFFER_STORAGE_BYTES, CANCEL_OFFER_GAS_WANTED, MAKE_OFFER_GAS_WANTED, OFFER_STORAGE_BYTES,
    buildAcceptOfferMsgs, buildCancelOfferMsg, buildMakeOfferMsg, type MadeOfferKind,
} from "../../../../lib/nft/trade"
import { laneClosedReason, readActionStatus } from "../../../../lib/tokenLaunchpadConfigClient"
import type { SettledOutcome, SignRequest } from "../../../sign/signer"
import { verifySendTx } from "../../../wallet/sendRequest"
import { utc } from "./reads"
import { available, payouts, sameSplit } from "./tradeRequest"

interface Common {
    caller: string
    networkKey: string
    chainId: string
    gas: GasPrice
    onSettled?: (outcome: SettledOutcome) => void
}

export interface MakeOfferDraft extends Common {
    kind: MadeOfferKind
    collection: string
    /** 0 for a collection offer. */
    number: bigint
    /** In ugnot. */
    price: bigint
    expiresAt: bigint
    /** The protocol fee in force and the split it gives, as read when the member asked. */
    feeBPS: bigint
    split: NftSplit
}

async function assertLaneOpen(networkKey: string): Promise<void> {
    const lane = await readActionStatus(networkKey, "nft_market", "ugnot")
    if (!lane.open) throw new Error(`${laneClosedReason(lane, "Trading")} Nothing was sent.`)
}

const target = (offer: { kind: string; collection: string; number: bigint }) =>
    offer.kind === "token" ? `${offer.collection} #${offer.number}` : `any token of ${offer.collection}`

export function makeOfferRequest(draft: MakeOfferDraft): SignRequest {
    available(draft)
    const msg = buildMakeOfferMsg(draft.caller, { ...draft, maxFeeBPS: draft.feeBPS })
    const fee = feeForGasWanted(MAKE_OFFER_GAS_WANTED, draft.gas)
    const what = target(draft)
    const price = formatAmount(draft.price, "ugnot")
    return {
        title: "Make an offer",
        summary: `Offer ${price} for ${what}`,
        sub: draft.kind === "token" ? "A token offer" : "A collection offer: any holder may accept it",
        lines: () => [
            ["Account", draft.caller],
            ["For", what],
            ["Price", `${price}, held by the market until the offer closes`],
            ...payouts({ split: draft.split, feeBPS: draft.feeBPS, currency: "ugnot" }).map(([to, amount]): [string, string] => [`If accepted: ${to.charAt(0).toLowerCase()}${to.slice(1)}`, amount]),
            ["Expires", utc(draft.expiresAt)],
            ["Market realm", NFT_MARKET_PATH],
            ["Network", draft.chainId],
            ["Storage deposit", `Up to ${formatUgnot(depositCapUgnot(OFFER_STORAGE_BYTES))}; it goes to whoever closes the offer`],
            ["Network fee", formatUgnotExact(fee)],
        ],
        note: "You can take the price back at any time with Cancel offer, paused market or not. After it expires, the offer can no longer be accepted; a week later anyone may return its price to you.",
        label: () => `Offer for ${what}`,
        prepare: () => ({ msgs: [msg] }),
        recheck: async () => {
            available(draft)
            if (draft.expiresAt * 1000n <= BigInt(Date.now()) + 60_000n) throw new Error("This offer's expiry has passed. Nothing was sent. Close the review and make the offer again.")
            await assertLaneOpen(draft.networkKey)
            if (draft.kind === "token") {
                const token = await getToken(draft.collection, draft.number)
                if (token.status !== "active") throw new Error(`${what} can no longer be bought. Nothing was sent.`)
                if (token.owner === draft.caller) throw new Error(`This account already holds ${what}. Nothing was sent.`)
            }
            const terms = await getMarketTerms(draft.collection, draft.price)
            if (terms.feeBPS !== draft.feeBPS || terms.split === null || !sameSplit(terms.split, draft.split)) throw new Error("The market's terms changed after your review. Nothing was sent. Close the review and read them again.")
            await assertFeeStillCovers(fee, () => freshFeeForGasWanted(MAKE_OFFER_GAS_WANTED))
        },
        send: (_choice, beforeSign) => doContractBroadcast([msg], `Offer for ${what}`, { gasWanted: MAKE_OFFER_GAS_WANTED, gasFee: fee, beforeSign }),
        verify: (_choice, hash) => verifySendTx(hash),
        onSettled: draft.onSettled,
    }
}

export interface OfferDraft extends Common {
    /** The offer as read when the member asked. */
    offer: NftOffer
}

export function cancelOfferRequest(draft: OfferDraft): SignRequest {
    available(draft)
    const { offer } = draft
    const msg = buildCancelOfferMsg(draft.caller, offer)
    const fee = feeForGasWanted(CANCEL_OFFER_GAS_WANTED, draft.gas)
    return {
        title: "Cancel offer",
        summary: `Take back ${formatAmount(offer.price, offer.currency)} from offer ${offer.id}`,
        sub: `For ${target(offer)}`,
        lines: () => [
            ["Account", draft.caller],
            ["Offer", `${offer.id}, for ${target(offer)}`],
            ["Comes back to you", formatAmount(offer.price, offer.currency)],
            ["Market realm", NFT_MARKET_PATH],
            ["Network", draft.chainId],
            ["Storage deposit", "The offer's deposit (about 0.78 GNOT) comes back to you"],
            ["Network fee", formatUgnotExact(fee)],
        ],
        note: "The offer closes and can no longer be accepted.",
        label: () => `Cancel offer ${offer.id}`,
        prepare: () => ({ msgs: [msg] }),
        recheck: async () => {
            available(draft)
            const read = await getOffer(offer.id)
            if (read === null) throw new Error("This offer has already closed. Nothing was sent.")
            if (read.buyer !== draft.caller) throw new Error("Only the buyer can cancel this offer. Nothing was sent.")
            await assertFeeStillCovers(fee, () => freshFeeForGasWanted(CANCEL_OFFER_GAS_WANTED))
        },
        send: (_choice, beforeSign) => doContractBroadcast([msg], `Cancel offer ${offer.id}`, { gasWanted: CANCEL_OFFER_GAS_WANTED, gasFee: fee, beforeSign }),
        verify: (_choice, hash) => verifySendTx(hash),
        onSettled: draft.onSettled,
    }
}

export interface AcceptDraft extends OfferDraft {
    /** The token the holder sells to the offer. */
    number: bigint
    /** The token's open listing, whoever listed it, which the sale closes (the market keeps one per token). */
    listing: string | null
}

export function acceptOfferRequest(draft: AcceptDraft): SignRequest {
    available(draft)
    const { offer, number } = draft
    const msgs = buildAcceptOfferMsgs(draft.caller, offer, number)
    const fee = feeForGasWanted(ACCEPT_OFFER_GAS_WANTED, draft.gas)
    const token = `${offer.collection} #${number}`
    return {
        title: "Accept offer",
        summary: `Sell ${token} for ${formatAmount(offer.price, offer.currency)}`,
        sub: `Offer ${offer.id} from ${offer.buyer}`,
        lines: () => [
            ["Account", draft.caller],
            ["Token", token],
            ["Price", formatAmount(offer.price, offer.currency)],
            ...payouts(offer),
            ["Buyer", offer.buyer],
            ...(draft.listing ? [["Listing", `${draft.listing} closes with this sale`] as [string, string]] : []),
            ["Approval", "The market may move this one token, for this sale"],
            ["Realms", `${NFT_LEDGER_PATH}, then ${NFT_MARKET_PATH}`],
            ["Network", draft.chainId],
            ["Storage deposit", `Up to ${formatUgnot(depositCapUgnot(APPROVE_STORAGE_BYTES) + depositCapUgnot(ACCEPT_OFFER_STORAGE_BYTES))}; the offer's own deposit comes back to you`],
            ["Network fee", formatUgnotExact(fee)],
        ],
        note: "The token and the payment move in the same transaction: either both happen or neither does.",
        label: () => `Sell ${token}`,
        prepare: () => ({ msgs }),
        recheck: async () => {
            available(draft)
            await assertLaneOpen(draft.networkKey)
            const read = await getOffer(offer.id)
            if (read === null) throw new Error("This offer has closed. Nothing was sent.")
            const same = read.kind === offer.kind && read.collection === offer.collection && read.number === offer.number && read.buyer === offer.buyer &&
                read.price === offer.price && read.currency === offer.currency && read.feeBPS === offer.feeBPS && read.expiresAt === offer.expiresAt &&
                sameSplit(read.split, offer.split)
            if (!same) throw new Error("This offer changed after your review. Nothing was sent. Close the review and read it again.")
            // A minute's margin, as for a new offer: one that expires before the block would fail on chain and cost the fee.
            if (read.expiresAt * 1000n <= BigInt(Date.now()) + 60_000n) throw new Error("This offer has expired or expires within a minute. Nothing was sent.")
            const held = await getToken(offer.collection, number)
            if (held.status !== "active" || held.owner !== draft.caller) throw new Error(`This account no longer holds ${token}. Nothing was sent.`)
            const current = await getTokenListing(offer.collection, number)
            if ((current?.id ?? null) !== draft.listing) throw new Error(`The open listing of ${token} changed after your review. Nothing was sent. Close the review and read it again.`)
            await assertFeeStillCovers(fee, () => freshFeeForGasWanted(ACCEPT_OFFER_GAS_WANTED))
        },
        send: (_choice, beforeSign) => doContractBroadcast(msgs, `Sell ${token}`, { gasWanted: ACCEPT_OFFER_GAS_WANTED, gasFee: fee, beforeSign }),
        verify: (_choice, hash) => verifySendTx(hash),
        onSettled: draft.onSettled,
    }
}
