/** A native OS review post goes through the same reviewed signing path as other OS writes. */
import { fetchAppStrict, isSafeRealmPath } from "../../../lib/appStore"
import { isAppReviewsAvailable, isRealmValidOn } from "../../../lib/config"
import { isValidGnoAddressChecksum } from "../../../lib/dao/address"
import { formatUgnot, formatUgnotExact, STORAGE_PRICE_UGNOT } from "../../../lib/dao/v2Budget"
import { doContractBroadcast, feeForGasWanted, networkGasPriceFresh, type GasPrice } from "../../../lib/grc20"
import { buildPostReviewMsg, REVIEW_BODY_MAX_BYTES } from "../../../lib/reviews"
import type { SettledOutcome, SignRequest } from "../../sign/signer"
import { verifySendTx } from "../../wallet/sendRequest"

export interface StoreReviewDraft {
    subject: string
    appName: string
    caller: string
    rating: number
    body: string
    realmPath: string
    networkKey: string
    chainId: string
    /** The network gas price the fee is quoted at, read from the chain when the sheet is asked for; a rise is caught again before the wallet opens. */
    price: GasPrice
    onSettled?: (outcome: SettledOutcome) => void
}

/**
 * Gas limit and storage deposit for PostReview, from simulations against
 * gno.land/r/samcrew/memba_reviews_v2 on gnoland-1 (2026-09-30). That is the realm App Store
 * reviews move to; the realm this build is configured for is not deployed, so the composer fails
 * closed until then.
 *
 *   new review, rating only                  12,165 B
 *   new review, 2,000-byte body              14,173 B
 *   the same for a 200-character subject     15,530 B
 *   replacing a review                       only the growth of its body
 *
 * A new review used 7.47M to 7.55M gas and a replacement about 0.58M more; the limit is about
 * twice that. The cap is twice the worst case, taken as 16,000 bytes, at 100 ugnot per byte. The
 * chain locks only the bytes a call adds, and without a cap it would accept up to its 100 GNOT
 * default.
 */
const REVIEW_GAS_WANTED = 15_000_000
const REVIEW_BASE_BYTES = 12_165
const REVIEW_MAX_DEPOSIT_UGNOT = 16_000 * 2 * STORAGE_PRICE_UGNOT

/** The review as it will be signed: checked, with its body trimmed. Throws with a user message. */
function validated(draft: StoreReviewDraft): StoreReviewDraft {
    const body = draft.body.trim()
    if (!isSafeRealmPath(draft.subject)) throw new Error("This app's realm path is invalid. Refresh its listing.")
    if (!isAppReviewsAvailable() || !isRealmValidOn(draft.networkKey, draft.realmPath)) throw new Error("App reviews are not available on this network.")
    if (!isValidGnoAddressChecksum(draft.caller)) throw new Error("Connect your wallet before reviewing.")
    if (!Number.isInteger(draft.rating) || draft.rating < 1 || draft.rating > 5) throw new Error("Select a rating from 1 to 5.")
    if (new TextEncoder().encode(body).length > REVIEW_BODY_MAX_BYTES) throw new Error(`Review text must be ${REVIEW_BODY_MAX_BYTES.toLocaleString("en-US")} bytes or fewer.`)
    return { ...draft, body }
}

export function storeReviewRequest(draft: StoreReviewDraft): SignRequest {
    // Copied here, so the sheet, the recheck and the signed message describe the same review.
    const review = validated(draft)
    const post = buildPostReviewMsg(review.caller, review.subject, review.rating, review.body, review.realmPath)
    const msg = { ...post, value: { ...post.value, max_deposit: `${REVIEW_MAX_DEPOSIT_UGNOT}ugnot` } }
    const deposit = (REVIEW_BASE_BYTES + new TextEncoder().encode(review.body).length) * STORAGE_PRICE_UGNOT
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
            ["Reviews realm", review.realmPath],
            ["Network", review.chainId],
            ["Storage deposit", `≈ ${formatUgnot(deposit)} for a new review, less when replacing one (cap ${formatUgnot(REVIEW_MAX_DEPOSIT_UGNOT)})`],
            ["Network fee", formatUgnotExact(fee)],
        ],
        acks: ["I understand this review is public and its chain history cannot be erased."],
        note: "Posting again for this app replaces your rating and text. A wallet signature proves authorship, not app use.",
        label: () => `Review ${review.appName}`,
        prepare: () => ({ msgs: [msg] }),
        recheck: async () => {
            validated(review)
            // Strict: a registry outage must surface as one, not as a delisted app.
            const listing = await fetchAppStrict(review.subject)
            if (!listing || listing.status !== "live") throw new Error("This app is no longer a live listing. Refresh before reviewing.")
            if (listing.name !== review.appName) throw new Error("This app's listing changed. Refresh before reviewing.")
            let freshFee: number
            try { freshFee = feeForGasWanted(REVIEW_GAS_WANTED, await networkGasPriceFresh()) }
            catch { throw new Error("Couldn't confirm the current network fee. Nothing was sent; try again when the network is available.") }
            if (freshFee > fee) throw new Error("The network fee increased since review. Close this review and check the new fee before signing.")
        },
        send: (_choice, beforeSign) => doContractBroadcast([msg], "Review app", { gasWanted: REVIEW_GAS_WANTED, gasFee: fee, beforeSign }),
        verify: (_choice, hash) => verifySendTx(hash),
        onSettled: review.onSettled,
    }
}
