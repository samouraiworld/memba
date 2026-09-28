/** A native OS review post goes through the same reviewed signing path as other OS writes. */
import { fetchApp, isSafeRealmPath } from "../../../lib/appStore"
import { isAppReviewsAvailable, isRealmValidOn } from "../../../lib/config"
import { doContractBroadcast } from "../../../lib/grc20"
import { buildPostReviewMsg } from "../../../lib/reviews"
import type { SettledOutcome, SignRequest } from "../../sign/signer"

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

function validated(draft: StoreReviewDraft): { body: string; msg: ReturnType<typeof buildPostReviewMsg> } {
    const body = draft.body.trim()
    if (!isSafeRealmPath(draft.subject)) throw new Error("This app's realm path is invalid. Refresh its listing.")
    if (!isAppReviewsAvailable() || !isRealmValidOn(draft.networkKey, draft.realmPath)) throw new Error("App reviews are not available on this network.")
    if (!/^g1[02-9ac-hj-np-z]{38}$/.test(draft.caller)) throw new Error("Connect your wallet before reviewing.")
    if (!Number.isInteger(draft.rating) || draft.rating < 1 || draft.rating > 5) throw new Error("Select a rating from 1 to 5.")
    if (new TextEncoder().encode(body).length > 2000) throw new Error("Review text must be 2,000 bytes or fewer.")
    return { body, msg: buildPostReviewMsg(draft.caller, draft.subject, draft.rating, body, draft.realmPath) }
}

export function storeReviewRequest(draft: StoreReviewDraft): SignRequest {
    const { body, msg } = validated(draft)
    return {
        title: "App review",
        summary: `Review ${draft.appName}`,
        sub: "Public onchain review",
        lines: () => [
            ["Rating", `${draft.rating} of 5 stars`],
            ["Review", body || "Rating only"],
            ["App realm", draft.subject],
            ["Reviews realm", draft.realmPath],
            ["Network", draft.chainId],
            ["Fee", "Shown in Adena before signing"],
        ],
        acks: ["I understand this review is public and its chain history cannot be erased."],
        note: "Posting again for this app updates your existing visible review. A wallet signature proves authorship, not app use.",
        label: () => `Review ${draft.appName}`,
        prepare: () => ({ msgs: [msg] }),
        recheck: async () => {
            validated(draft)
            const listing = await fetchApp(draft.subject)
            if (!listing || listing.status !== "live") throw new Error("This app is no longer a live listing. Refresh before reviewing.")
        },
        send: (_choice, beforeSign) => doContractBroadcast([msg], "Review app", { retry: false, beforeSign }),
        onSettled: (outcome) => draft.onSettled?.(outcome),
    }
}
