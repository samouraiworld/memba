/** An action on a review or a reply (like, flag, reply, edit, delete) through the OS signing sheet. */
import { isAppReviewsAvailable, isRealmValidOn } from "../../../lib/config"
import { isValidGnoAddressChecksum } from "../../../lib/dao/address"
import { depositCapUgnot, formatUgnot, formatUgnotExact, STORAGE_PRICE_UGNOT } from "../../../lib/dao/v2Budget"
import { assertFeeStillCovers, doContractBroadcast, feeForGasWanted, freshFeeForGasWanted, type GasPrice } from "../../../lib/grc20"
import {
    assertReviewActionApplies, REPLY_BODY_MAX_BYTES, REVIEW_BODY_MAX_BYTES, REVIEW_GAS_WANTED, REVIEWS_PKG_PATH,
    reviewActionMsg, reviewActionOn, reviewActionStorageBytes, reviewActionTarget, type ReviewAction,
} from "../../../lib/reviews"
import type { SettledOutcome, SignRequest } from "../../sign/signer"
import { verifySendTx } from "../../wallet/sendRequest"
import { withFeeCheck } from "../../sign/recheck"

export interface StoreReviewAction {
    action: ReviewAction
    appName: string
    caller: string
    networkKey: string
    chainId: string
    /** The network gas price the fee is quoted at, read from the chain when the sheet is asked for; a rise is caught again before the wallet opens. */
    price: GasPrice
    onSettled?: (outcome: SettledOutcome) => void
}

const bytes = (text: string) => new TextEncoder().encode(text).length

/** What the sheet calls the action, how its deposit line reads for an amount, and what its note says. */
function wording(action: ReviewAction): { title: string; deposit: (amount: string) => string; note: string; ack?: string } {
    const on = reviewActionOn(action)
    switch (action.kind) {
        case "react": return {
            title: `${action.reaction === "like" ? "Like" : "Dislike"} a ${on}`, deposit: (amount) => `≈ ${amount} for a first reaction on it`,
            note: "A first like or dislike locks its storage deposit. Choosing the other one costs almost nothing more, and choosing the same one again undoes it and returns about half.",
        }
        case "flag": return {
            title: `Flag a ${on}`, deposit: (amount) => `≈ ${amount}, not returned`,
            note: "A flag is recorded for the moderator and cannot be withdrawn; it hides nothing by itself. Flagging the same item a second time fails, and a failed transaction still costs its fee.",
            ack: "I understand this flag is public and cannot be withdrawn.",
        }
        case "reply": return {
            title: "Reply to a review", deposit: (amount) => `Up to ${amount}`,
            note: "The storage deposit is locked with the reply. Deleting the reply later returns only what its text took; the rest stays locked.",
            ack: "I understand this reply is public and its chain history cannot be erased.",
        }
        case "editReview":
        case "editReply": {
            const removed = bytes(action.was) - bytes(action.body)
            return {
            title: `Edit your ${on}`,
            deposit: (amount) => removed > 0
                ? `None: up to ${formatUgnotExact(removed * STORAGE_PRICE_UGNOT)} returned for the text removed`
                : `Up to ${amount} for the text this edit adds`,
            note: "An edit locks more deposit only for the text it adds, and returns what a shorter text frees. The earlier text stays in the chain's history.",
            ack: `I understand this ${on} is public and its chain history cannot be erased.`,
            }
        }
        case "deleteReview":
        case "deleteReply": return {
            title: `Delete your ${on}`, deposit: (amount) => `at most ${amount}`,
            note: `Deleting removes your ${on} from the public list. Its chain history remains.`,
        }
    }
}

/** The action as it will be signed, checked. Throws with a user message. */
function validated(input: StoreReviewAction): StoreReviewAction {
    const { action } = input
    if (!isAppReviewsAvailable() || !isRealmValidOn(input.networkKey, REVIEWS_PKG_PATH)) throw new Error("App reviews are not available on this network.")
    if (!isValidGnoAddressChecksum(input.caller)) throw new Error("Connect your wallet first.")
    if (!Number.isSafeInteger(reviewActionTarget(action)) || reviewActionTarget(action) < 1) throw new Error("This review cannot be identified. Refresh the reviews.")
    if (action.kind === "editReview" && (!Number.isInteger(action.rating) || action.rating < 1 || action.rating > 5)) throw new Error("Select a rating from 1 to 5.")
    if (action.kind === "editReview" && bytes(action.body) > REVIEW_BODY_MAX_BYTES) throw new Error(`Review text must be ${REVIEW_BODY_MAX_BYTES.toLocaleString("en-US")} bytes or fewer.`)
    if ((action.kind === "reply" || action.kind === "editReply") && (action.body === "" || bytes(action.body) > REPLY_BODY_MAX_BYTES)) throw new Error(`A reply must be 1 to ${REPLY_BODY_MAX_BYTES.toLocaleString("en-US")} bytes.`)
    return input
}

export function reviewActionRequest(input: StoreReviewAction): SignRequest {
    // Copied here, so the sheet, the recheck and the signed message describe the same action.
    const { action, caller, appName, chainId, onSettled } = validated({ ...input, action: { ...input.action } })
    const msg = reviewActionMsg(caller, action)
    const storage = reviewActionStorageBytes(action)
    const fee = feeForGasWanted(REVIEW_GAS_WANTED, input.price)
    const { title, deposit, note, ack } = wording(action)
    const text: [string, string][] = action.kind === "reply" ? [["Reply", action.body]]
        : action.kind === "editReply" ? [["New text", action.body]]
        : action.kind === "editReview" ? [["Rating", `${action.rating} of 5 stars`], ["New text", action.body || "Rating only"]]
        : []
    return {
        title,
        summary: `${title} of ${appName}`,
        sub: "Public onchain action",
        lines: () => [
            ["Account", caller],
            [reviewActionOn(action) === "reply" ? "Reply" : "Review", `#${reviewActionTarget(action)}`],
            ...text,
            ["Reviews realm", REVIEWS_PKG_PATH],
            ["Network", chainId],
            ["Storage deposit", `${deposit(formatUgnot(storage * STORAGE_PRICE_UGNOT))} (cap ${formatUgnot(depositCapUgnot(storage))})`],
            ["Network fee", formatUgnotExact(fee)],
        ],
        acks: ack ? [ack] : undefined,
        note,
        label: () => title,
        prepare: () => ({ msgs: [msg] }),
        recheck: async () => {
            validated(input)
            await withFeeCheck(assertReviewActionApplies(caller, action), assertFeeStillCovers(fee, () => freshFeeForGasWanted(REVIEW_GAS_WANTED)))
        },
        send: (_choice, beforeSign) => doContractBroadcast([msg], title, { gasWanted: REVIEW_GAS_WANTED, gasFee: fee, beforeSign }),
        verify: (_choice, hash) => verifySendTx(hash),
        onSettled,
    }
}
