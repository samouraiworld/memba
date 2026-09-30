/** A native OS review post goes through the same reviewed signing path as other OS writes. */
import { fetchAppStrict, isSafeRealmPath } from "../../../lib/appStore"
import { isAppReviewsAvailable, isRealmValidOn } from "../../../lib/config"
import { isValidGnoAddressChecksum } from "../../../lib/dao/address"
import { depositCapUgnot, formatUgnot, formatUgnotExact, STORAGE_PRICE_UGNOT } from "../../../lib/dao/v2Budget"
import { assertFeeStillCovers, doContractBroadcast, feeForGasWanted, freshFeeForGasWanted, type GasPrice } from "../../../lib/grc20"
import { buildPostReviewMsg, REVIEW_BODY_MAX_BYTES, REVIEW_GAS_WANTED, REVIEWS_PKG_PATH, reviewStorageBytes } from "../../../lib/reviews"
import type { SettledOutcome, SignRequest } from "../../sign/signer"
import { verifySendTx } from "../../wallet/sendRequest"

export interface StoreReviewDraft {
    subject: string
    appName: string
    caller: string
    rating: number
    body: string
    networkKey: string
    chainId: string
    /** The network gas price the fee is quoted at, read from the chain when the sheet is asked for; a rise is caught again before the wallet opens. */
    price: GasPrice
    onSettled?: (outcome: SettledOutcome) => void
}

/** The review as it will be signed: checked, with its body trimmed. Throws with a user message. */
function validated(draft: StoreReviewDraft): StoreReviewDraft {
    const body = draft.body.trim()
    if (!isSafeRealmPath(draft.subject)) throw new Error("This app's realm path is invalid. Refresh its listing.")
    if (!isAppReviewsAvailable() || !isRealmValidOn(draft.networkKey, REVIEWS_PKG_PATH)) throw new Error("App reviews are not available on this network.")
    if (!isValidGnoAddressChecksum(draft.caller)) throw new Error("Connect your wallet before reviewing.")
    if (!Number.isInteger(draft.rating) || draft.rating < 1 || draft.rating > 5) throw new Error("Select a rating from 1 to 5.")
    if (new TextEncoder().encode(body).length > REVIEW_BODY_MAX_BYTES) throw new Error(`Review text must be ${REVIEW_BODY_MAX_BYTES.toLocaleString("en-US")} bytes or fewer.`)
    return { ...draft, body }
}

export function storeReviewRequest(draft: StoreReviewDraft): SignRequest {
    // Copied here, so the sheet, the recheck and the signed message describe the same review.
    const review = validated(draft)
    const msg = buildPostReviewMsg(review.caller, review.subject, review.rating, review.body)
    const bytes = reviewStorageBytes(review.subject, review.body)
    const fee = feeForGasWanted(REVIEW_GAS_WANTED, review.price)
    return {
        title: "App review",
        summary: `Review ${review.appName}`,
        sub: "Public onchain review",
        lines: () => [
            ["Account", review.caller],
            ["Rating", `${review.rating} of 5 stars`],
            ["Review", review.body || "Rating only"],
            ["App realm", review.subject],
            ["Reviews realm", REVIEWS_PKG_PATH],
            ["Network", review.chainId],
            ["Storage deposit", `Up to ${formatUgnot(bytes * STORAGE_PRICE_UGNOT)} for the first review of this app, less for a later one or a replacement (cap ${formatUgnot(depositCapUgnot(bytes))})`],
            ["Network fee", formatUgnotExact(fee)],
        ],
        acks: ["I understand this review is public and its chain history cannot be erased."],
        note: "The storage deposit stays locked with the review; deleting it returns only a small part. Posting again for this app replaces your rating and text, unless a moderator hid your review: then it is a new review with its own deposit. A wallet signature proves authorship, not app use.",
        label: () => `Review ${review.appName}`,
        prepare: () => ({ msgs: [msg] }),
        recheck: async () => {
            validated(review)
            // Strict: a registry outage must surface as one, not as a delisted app.
            const listing = await fetchAppStrict(review.subject)
            if (!listing || listing.status !== "live") throw new Error("This app is no longer a live listing. Refresh before reviewing.")
            if (listing.name !== review.appName) throw new Error("This app's listing changed. Refresh before reviewing.")
            await assertFeeStillCovers(fee, () => freshFeeForGasWanted(REVIEW_GAS_WANTED))
        },
        send: (_choice, beforeSign) => doContractBroadcast([msg], "Review app", { gasWanted: REVIEW_GAS_WANTED, gasFee: fee, beforeSign }),
        verify: (_choice, hash) => verifySendTx(hash),
        onSettled: review.onSettled,
    }
}
