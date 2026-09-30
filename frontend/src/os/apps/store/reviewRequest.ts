/** A native OS review post goes through the same reviewed signing path as other OS writes. */
import { fetchAppStrict, isSafeRealmPath } from "../../../lib/appStore"
import { isAppReviewsAvailable, isRealmValidOn } from "../../../lib/config"
import { isValidGnoAddressChecksum } from "../../../lib/dao/address"
import { formatUgnot, STORAGE_PRICE_UGNOT } from "../../../lib/dao/v2Budget"
import { doContractBroadcast } from "../../../lib/grc20"
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
    onSettled?: (outcome: SettledOutcome) => void
}

/**
 * Storage-deposit cap for PostReview: twice an estimate of 10,000 bytes (the review record, its
 * index entries and the tree nodes an insert rewrites) plus the largest body, at 100 ugnot per
 * byte. The estimate follows the measured escrow and attestation records; it has not been
 * measured on the reviews realm. The chain locks only the bytes a call adds, and without a cap
 * it would accept up to its 100 GNOT default.
 */
const REVIEW_MAX_DEPOSIT_UGNOT = (10_000 + REVIEW_BODY_MAX_BYTES) * 2 * STORAGE_PRICE_UGNOT

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
            ["Storage deposit", `up to ${formatUgnot(REVIEW_MAX_DEPOSIT_UGNOT)}`],
            ["Fee", "Shown in Adena before signing"],
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
        },
        send: (_choice, beforeSign) => doContractBroadcast([msg], "Review app", { retry: false, beforeSign }),
        verify: (_choice, hash) => verifySendTx(hash),
        onSettled: review.onSettled,
    }
}
