/**
 * questClaims.ts — self-report quest claim submission + admin review.
 *
 * Self-report quests can't be auto-verified; the user submits proof (a URL
 * and/or text) via SubmitQuestClaim, and an admin approves/rejects it via the
 * admin review page (ReviewQuestClaim / ListPendingClaims). On approval the
 * backend records the completion + queues the badge.
 */

import { api } from "./api"
import { create } from "@bufbuild/protobuf"
import {
    SubmitQuestClaimRequestSchema,
    ReviewQuestClaimRequestSchema,
    ListPendingClaimsRequestSchema,
} from "../gen/memba/v1/memba_pb"
import type { Token, QuestClaim } from "../gen/memba/v1/memba_pb"

const CLAIMS_KEY_BASE = "memba_quest_claims"

function claimsKey(address: string): string {
    return `${CLAIMS_KEY_BASE}_${address}`
}

/** Quest ids the user has submitted a self-report claim for (pending review). */
export function getSubmittedClaims(address: string): string[] {
    if (!address) return []
    try {
        const raw = localStorage.getItem(claimsKey(address))
        const list = raw ? JSON.parse(raw) : []
        return Array.isArray(list) ? list : []
    } catch {
        return []
    }
}

/** True if the user already submitted a claim for this quest (shows as pending). */
export function hasSubmittedClaim(address: string, questId: string): boolean {
    return getSubmittedClaims(address).includes(questId)
}

/**
 * Submit a self-report quest claim with proof, and record it locally as pending
 * so the UI reflects the pending state across reloads. The backend dedupes by
 * (address, quest_id), so re-submitting is harmless.
 */
export async function submitQuestClaim(
    authToken: Token,
    address: string,
    questId: string,
    proofUrl: string,
    proofText: string,
): Promise<void> {
    await api.submitQuestClaim(create(SubmitQuestClaimRequestSchema, {
        authToken,
        questId,
        proofUrl,
        proofText,
    }))
    try {
        const list = getSubmittedClaims(address)
        if (!list.includes(questId)) {
            list.push(questId)
            localStorage.setItem(claimsKey(address), JSON.stringify(list))
        }
    } catch {
        /* best effort */
    }
}

// ── Admin review ────────────────────────────────────────────

/** Fetch pending self-report claims (admin only; server enforces). */
export async function listPendingClaims(authToken: Token): Promise<QuestClaim[]> {
    const resp = await api.listPendingClaims(create(ListPendingClaimsRequestSchema, { authToken }))
    return resp.claims ?? []
}

/** Approve or reject a pending claim (admin only). Returns the new status. */
export async function reviewQuestClaim(
    authToken: Token,
    claimId: bigint,
    approved: boolean,
): Promise<string> {
    const resp = await api.reviewQuestClaim(create(ReviewQuestClaimRequestSchema, {
        authToken,
        claimId,
        approved,
    }))
    return resp.status
}
