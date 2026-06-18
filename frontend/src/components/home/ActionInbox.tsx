/**
 * ActionInbox — "Act now" section of the member Control Room spine.
 *
 * - VOTE actions: render QuickVoteWidget for inline voting (no page navigation)
 * - SIGN/CANDIDATURE actions: render ActionCards that deep-link to their pages
 * - loading: 3 skeleton ActionCards
 * - allCaughtUp: one neutral "You're all caught up" ActionCard with browse DAOs link
 *
 * Inline vote wiring mirrors Dashboard.tsx exactly:
 *   buildVoteMsg → doContractBroadcast → setVotedIds + clearVoteCache
 *
 * Proposals come from useHomeActions (single useUnvotedProposals call shared
 * with the action-builder — no duplicate cold-load scan).
 */

import { useState } from "react"
import { useOutletContext } from "react-router-dom"
import { useHomeActions } from "../../hooks/home/useHomeActions"
import { ActionCard } from "./ActionCard"
import { QuickVoteWidget } from "../dashboard/QuickVoteWidget"
import { buildVoteMsg } from "../../lib/dao"
import { doContractBroadcast } from "../../lib/grc20"
import { clearVoteCache } from "../../lib/dao/voteScanner"
import { logChainError } from "../../lib/errorLog"
import { useNetworkPath } from "../../hooks/useNetworkNav"
import type { LayoutContext } from "../../types/layout"

export function ActionInbox() {
    const { auth } = useOutletContext<LayoutContext>()
    const { actions, loading, allCaughtUp, unvotedProposals = [] } = useHomeActions(auth)
    const buildPath = useNetworkPath()

    // Inline vote state — mirrors Dashboard.tsx handleQuickVote
    const userAddress = auth.isAuthenticated ? (auth.address || null) : null
    const [votingId, setVotingId] = useState<string | null>(null)
    const [votedIds, setVotedIds] = useState<Set<string>>(new Set())

    const handleQuickVote = async (
        realmPath: string,
        proposalId: number,
        vote: "YES" | "NO",
    ) => {
        if (!userAddress) return
        const key = `${realmPath}:${proposalId}`
        setVotingId(key)
        try {
            const msg = buildVoteMsg(userAddress, realmPath, proposalId, vote)
            await doContractBroadcast([msg], `Vote ${vote} on proposal #${proposalId}`)
            setVotedIds(prev => new Set(prev).add(key))
            clearVoteCache()
        } catch (err) {
            logChainError(
                `home:quickVote:${realmPath}#${proposalId}`,
                err,
                "critical",
                userAddress,
            )
        } finally {
            setVotingId(null)
        }
    }

    // Optimistically hide proposals the user just voted on
    const visibleUnvoted = unvotedProposals.filter(
        p => !votedIds.has(`${p.realmPath}:${p.proposalId}`)
    )

    // Separate vote actions (shown via QuickVoteWidget) from deep-link actions
    const deepLinkActions = actions.filter(a => a.kind !== "vote")
    const hasVoteActions = actions.some(a => a.kind === "vote")

    const totalCount = actions.length

    // ── Loading ───────────────────────────────────────────────
    if (loading) {
        return (
            <section className="action-inbox" aria-label="Act now">
                <div className="action-inbox__header">
                    <h2 className="action-inbox__title">Act now</h2>
                </div>
                <div className="action-inbox__list">
                    <ActionCard loading title="" />
                    <ActionCard loading title="" />
                    <ActionCard loading title="" />
                </div>
            </section>
        )
    }

    // ── All caught up ─────────────────────────────────────────
    if (allCaughtUp) {
        return (
            <section className="action-inbox" aria-label="Act now">
                <div className="action-inbox__header">
                    <h2 className="action-inbox__title">Act now</h2>
                </div>
                <div className="action-inbox__list">
                    <ActionCard
                        accent="neutral"
                        eyebrow="inbox"
                        title="You're all caught up"
                        actionLabel="Browse DAOs"
                        href={buildPath("dao")}
                    />
                </div>
            </section>
        )
    }

    // ── Actions ───────────────────────────────────────────────
    return (
        <section className="action-inbox" aria-label="Act now">
            <div className="action-inbox__header">
                <h2 className="action-inbox__title">Act now</h2>
                <span className="action-inbox__count">
                    {totalCount} {totalCount === 1 ? "awaits" : "await"}
                </span>
            </div>

            <div className="action-inbox__list">
                {/* Inline vote widget for vote-kind actions */}
                {hasVoteActions && visibleUnvoted.length > 0 && (
                    <QuickVoteWidget
                        proposals={visibleUnvoted}
                        votingId={votingId}
                        votedIds={votedIds}
                        onVote={handleQuickVote}
                    />
                )}

                {/* Deep-link cards for sign + candidature */}
                {deepLinkActions.map(action => (
                    <ActionCard
                        key={action.id}
                        accent={action.accent}
                        eyebrow={action.eyebrow}
                        title={action.title}
                        meta={action.meta}
                        href={buildPath(action.href.replace(/^\//, ""))}
                        actionLabel={action.kind === "sign" ? "Sign" : "Apply"}
                    />
                ))}
            </div>
        </section>
    )
}
