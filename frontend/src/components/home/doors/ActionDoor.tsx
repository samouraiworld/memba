/**
 * ActionDoor — renders a single pending action as a Door variant="action".
 *
 * Layout:
 *   door__eyebrow  ← icon chip + mono eyebrow label
 *   door__body     ← title + mono meta (omitted if absent)
 *   action slot    ← for vote: QuickVoteWidget row; for sign/candidature: "Review & sign" / "Apply" link
 *
 * Accents:
 *   vote / claim / candidature → teal (--color-k-accent)
 *   sign                       → amber (--color-k-warning)
 *   reject button              → danger (--color-k-danger)
 *
 * Only surfaces "claim" for LIVE quest rewards; badge minting is gated and
 * must NOT appear here.
 *
 * @module components/home/doors/ActionDoor
 */

import { Link } from "react-router-dom"
import { Door } from "../Door"
import type { HomeAction } from "../../../hooks/home/useHomeActions"
import type { UnvotedProposal } from "../../../lib/dao/voteScanner"
import { QuickVoteWidget } from "../../dashboard/QuickVoteWidget"

// ── Icon chips ─────────────────────────────────────────────────

const KIND_ICON: Record<HomeAction["kind"], string> = {
    vote: "🗳",
    sign: "✍",
    claim: "🎁",
    candidature: "🌱",
}

// ── Sub-components ─────────────────────────────────────────────

function ActionDoorIcon({ kind }: { kind: HomeAction["kind"] }) {
    return (
        <span
            className={`action-door__chip action-door__chip--${kind}`}
            aria-hidden="true"
        >
            {KIND_ICON[kind]}
        </span>
    )
}

// ── ActionDoor ─────────────────────────────────────────────────

export interface ActionDoorProps {
    action: HomeAction
    // Vote-specific — only provided when kind === "vote"
    votingId?: string | null
    votedIds?: Set<string>
    unvotedProposals?: UnvotedProposal[]
    onVote?: (realmPath: string, proposalId: number, vote: "YES" | "NO") => void
}

export function ActionDoor({
    action,
    votingId = null,
    votedIds = new Set(),
    unvotedProposals = [],
    onVote,
}: ActionDoorProps) {
    // For vote actions, the QuickVoteWidget already renders the full row
    // (title, DAO name, YES/NO buttons). We still render the door frame so
    // the accent chip + eyebrow are consistent with the other action types.
    const isVote = action.kind === "vote"

    // Filter proposals to this specific vote action's proposal
    const relevantProposals = isVote
        ? unvotedProposals.filter(p => action.id === `vote:${p.realmPath}:${p.proposalId}`)
        : []

    const actionLabel =
        action.kind === "sign" ? "Review & sign" :
        action.kind === "candidature" ? "Apply" :
        action.kind === "claim" ? "Claim" :
        undefined

    return (
        <Door
            variant="action"
            eyebrow={action.eyebrow}
            icon={<ActionDoorIcon kind={action.kind} />}
        >
            <div className="action-door__content">
                <div className="action-door__body">
                    <span className="action-door__title">{action.title}</span>
                    {action.meta && (
                        <span className="action-door__meta">{action.meta}</span>
                    )}
                </div>

                {isVote && relevantProposals.length > 0 && onVote && (
                    <div className="action-door__vote-slot">
                        <QuickVoteWidget
                            proposals={relevantProposals}
                            votingId={votingId}
                            votedIds={votedIds}
                            onVote={onVote}
                        />
                    </div>
                )}

                {!isVote && actionLabel && action.href && (
                    <Link
                        to={action.href}
                        className={`action-door__cta action-door__cta--${action.kind}`}
                        aria-label={actionLabel}
                    >
                        {actionLabel}
                    </Link>
                )}
            </div>
        </Door>
    )
}

// ── Skeleton variant ───────────────────────────────────────────

export function ActionDoorSkeleton() {
    return (
        <Door
            variant="action"
            state="loading"
            eyebrow="loading"
        />
    )
}
