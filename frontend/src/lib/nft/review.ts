/**
 * The curation realm's two calls of the review cycle, as Memba signs them: a
 * collection's creator applies for review with a statement, and a seated
 * manager decides on the latest filing with a reason. Both commit a pinned
 * text by its (hash, CID) pair; neither moves coins or tokens. Review names
 * the revision the manager read, so a filing made in between is never decided
 * unseen.
 *
 * @module lib/nft/review
 */
import { depositCapUgnot } from "../dao/v2Budget"
import type { AminoMsg } from "../grc20"
import { NFT_CURATION_PATH, type CurationApplicationStatus } from "./curation"
import type { Commitment } from "./evidence"
import { address, cid, collectionId, hash } from "./parse"

/** At least twice the measured gas (apply and review 11.6 to 19M, by fixture; gas.test.ts has the figures). */
export const APPLY_GAS_WANTED = 40_000_000
export const REVIEW_GAS_WANTED = 40_000_000
/** A first filing stores about 3.5 KB and a review about 0.2 KB; the caps leave room for a longer collection ID and a re-filing. */
export const APPLY_STORAGE_BYTES = 5_000
export const REVIEW_STORAGE_BYTES = 1_000

/** The decisions a manager can record; "submitted" is the founder's. */
export const REVIEW_DECISIONS = ["changes_requested", "recommended", "declined"] as const
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number]

export const DECISION_LABEL: Record<CurationApplicationStatus, string> = {
    submitted: "Awaiting review",
    changes_requested: "Changes requested",
    recommended: "Recommended",
    declined: "Declined",
}

const call = (caller: string, func: string, args: string[], storageBytes: number): AminoMsg => ({
    type: "vm/MsgCall",
    value: { caller: address(caller, "account"), send: "", pkg_path: NFT_CURATION_PATH, func, args, max_deposit: `${depositCapUgnot(storageBytes)}ugnot` },
})

export function buildApplyMsg(caller: string, collection: string, statement: Commitment): AminoMsg {
    return call(caller, "Apply", [collectionId(collection), hash(statement.hash, "statement hash"), cid(statement.cid, "statement CID")], APPLY_STORAGE_BYTES)
}

export function buildReviewMsg(caller: string, collection: string, revision: bigint, decision: ReviewDecision, reason: Commitment): AminoMsg {
    if (typeof revision !== "bigint" || revision < 1n) throw new Error("Invalid revision")
    if (!REVIEW_DECISIONS.includes(decision)) throw new Error("Invalid decision")
    return call(caller, "Review", [collectionId(collection), revision.toString(), decision, hash(reason.hash, "reason hash"), cid(reason.cid, "reason CID")], REVIEW_STORAGE_BYTES)
}
