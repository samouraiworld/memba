/**
 * Applying for review and deciding on an application go through the OS review
 * sheet. The text is pinned first, so the sheet shows the exact (hash, CID)
 * pair that will be committed. Right before the wallet opens, the role and the
 * application are read again: a creator role handed over, a seat or a conflict
 * that changed, or a filing made in between stops the signature.
 *
 * @module os/apps/market/nft/reviewRequest
 */
import { isNftEnabled, isRealmValidOn } from "../../../../lib/config"
import { isValidGnoAddressChecksum } from "../../../../lib/dao/address"
import { depositCapUgnot, formatUgnot, formatUgnotExact } from "../../../../lib/dao/v2Budget"
import { assertFeeStillCovers, doContractBroadcast, feeForGasWanted, freshFeeForGasWanted, type GasPrice } from "../../../../lib/grc20"
import { NFT_CURATION_PATH, getApplication, getCurationAccess, type CurationApplication } from "../../../../lib/nft/curation"
import type { Commitment } from "../../../../lib/nft/evidence"
import { getCollection } from "../../../../lib/nft/ledger"
import {
    APPLY_GAS_WANTED, APPLY_STORAGE_BYTES, DECISION_LABEL, REVIEW_GAS_WANTED, REVIEW_STORAGE_BYTES, buildApplyMsg, buildReviewMsg, type ReviewDecision,
} from "../../../../lib/nft/review"
import type { SettledOutcome, SignRequest } from "../../../sign/signer"
import { verifySendTx } from "../../../wallet/sendRequest"

interface Draft {
    collection: string
    /** The pinned text and its commitment. */
    text: string
    commitment: Commitment
    /** The application as read when the member asked; null when there is none yet. */
    application: CurationApplication | null
    caller: string
    networkKey: string
    chainId: string
    gas: GasPrice
    onSettled?: (outcome: SettledOutcome) => void
}

export type ApplyDraft = Draft
export interface ReviewDraft extends Draft {
    application: CurationApplication
    decision: ReviewDecision
}

function available(draft: Draft): void {
    if (!isNftEnabled() || !isRealmValidOn(draft.networkKey, NFT_CURATION_PATH)) throw new Error("NFT curation is not available on this network.")
    if (!isValidGnoAddressChecksum(draft.caller)) throw new Error("Connect your wallet first.")
}

/** The application read again is the one reviewed: none, or the same filing with the same decision on it. */
async function assertSameApplication(collection: string, reviewed: CurationApplication | null): Promise<CurationApplication | null> {
    const read = await getApplication(collection)
    const same = reviewed === null ? read === null
        : read !== null && read.revision === reviewed.revision && read.status === reviewed.status && read.reviewer === reviewed.reviewer
    if (!same) throw new Error("This application changed after your review. Nothing was sent. Close the review and read it again.")
    return read
}

const textLines = (draft: Draft, what: string): [string, string][] => [
    [what, draft.text.length > 280 ? `${draft.text.slice(0, 280)}…` : draft.text],
    ["Pinned at", draft.commitment.cid],
    ["SHA-256", draft.commitment.hash],
]

export function applyRequest(draft: ApplyDraft): SignRequest {
    available(draft)
    const msg = buildApplyMsg(draft.caller, draft.collection, draft.commitment)
    const fee = feeForGasWanted(APPLY_GAS_WANTED, draft.gas)
    const refiling = draft.application !== null
    return {
        title: refiling ? "File again for review" : "Apply for review",
        summary: `${refiling ? "File" : "Apply"} ${draft.collection} for curation review`,
        sub: refiling ? `Filing ${draft.application!.revision + 1n}, replacing a ${DECISION_LABEL[draft.application!.status].toLowerCase()} filing` : "A first filing",
        lines: () => [
            ["Account", draft.caller],
            ["Collection", draft.collection],
            ...textLines(draft, "Statement"),
            ["Curation realm", NFT_CURATION_PATH],
            ["Network", draft.chainId],
            ["Storage deposit", `Up to ${formatUgnot(depositCapUgnot(APPLY_STORAGE_BYTES))}`],
            ["Network fee", formatUgnotExact(fee)],
        ],
        note: "Managers read your statement and decide: request changes, recommend, or decline. A recommendation is advice to the curation admin; it gives the collection nothing by itself. As the founder you are recorded as conflicted on this collection: you can never review it. The statement is public on IPFS.",
        label: () => `Apply ${draft.collection} for review`,
        prepare: () => ({ msgs: [msg] }),
        recheck: async () => {
            available(draft)
            const collection = await getCollection(draft.collection)
            if (collection.creator !== draft.caller) throw new Error("Only the collection's creator can apply, and this account no longer is. Nothing was sent.")
            const read = await assertSameApplication(draft.collection, draft.application)
            if (read?.status === "recommended") throw new Error("This collection is already recommended. Nothing was sent.")
            await assertFeeStillCovers(fee, () => freshFeeForGasWanted(APPLY_GAS_WANTED))
        },
        send: (_choice, beforeSign) => doContractBroadcast([msg], `Apply ${draft.collection} for review`, { gasWanted: APPLY_GAS_WANTED, gasFee: fee, beforeSign }),
        verify: (_choice, hash) => verifySendTx(hash),
        onSettled: draft.onSettled,
    }
}

export function reviewRequest(draft: ReviewDraft): SignRequest {
    available(draft)
    const { application, decision } = draft
    const msg = buildReviewMsg(draft.caller, draft.collection, application.revision, decision, draft.commitment)
    const fee = feeForGasWanted(REVIEW_GAS_WANTED, draft.gas)
    return {
        title: "Review an application",
        summary: `${DECISION_LABEL[decision]}: ${draft.collection}, filing ${application.revision}`,
        sub: `Founder ${application.founder}`,
        lines: () => [
            ["Account", draft.caller],
            ["Collection", draft.collection],
            ["Filing", `${application.revision}, ${DECISION_LABEL[application.status].toLowerCase()}`],
            ["Decision", DECISION_LABEL[decision]],
            ...textLines(draft, "Reason"),
            ["Curation realm", NFT_CURATION_PATH],
            ["Network", draft.chainId],
            ["Storage deposit", `Up to ${formatUgnot(depositCapUgnot(REVIEW_STORAGE_BYTES))}`],
            ["Network fee", formatUgnotExact(fee)],
        ],
        note: "Your decision is recorded under your seat with its reason, both public. It replaces the latest decision on this filing; a new filing by the founder reopens the application.",
        label: () => `Review ${draft.collection}`,
        prepare: () => ({ msgs: [msg] }),
        recheck: async () => {
            available(draft)
            const access = await getCurationAccess(draft.collection, draft.caller, draft.chainId)
            if (!access.manager) throw new Error("This account no longer holds a manager seat. Nothing was sent.")
            if (access.conflicted) throw new Error("This account is conflicted on this collection and cannot review it. Nothing was sent.")
            await assertSameApplication(draft.collection, application)
            await assertFeeStillCovers(fee, () => freshFeeForGasWanted(REVIEW_GAS_WANTED))
        },
        send: (_choice, beforeSign) => doContractBroadcast([msg], `Review ${draft.collection}`, { gasWanted: REVIEW_GAS_WANTED, gasFee: fee, beforeSign }),
        verify: (_choice, hash) => verifySendTx(hash),
        onSettled: draft.onSettled,
    }
}
