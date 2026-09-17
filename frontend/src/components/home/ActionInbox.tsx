/**
 * ActionInbox — "Act now" section of the member Control Room spine.
 *
 * Each pending action is rendered as an ActionDoor (Door variant="action"):
 *   - VOTE:        icon chip + eyebrow + inline QuickVoteWidget (approve/reject)
 *   - SIGN:        icon chip + eyebrow + title + meta + "Review & sign" link
 *   - CANDIDATURE: icon chip + eyebrow + title + "Apply" link
 *   - CLAIM:       icon chip + eyebrow + title + "Claim" link (LIVE rewards only)
 *
 * States:
 *   - loading:      3 ActionDoorSkeleton cards (Door variant="action" state="loading")
 *   - allCaughtUp:  single "You're all caught up." action door
 *   - ready:        one ActionDoor per action, count pill, "view all activity" footer
 *
 * Inline vote wiring mirrors Dashboard.tsx exactly:
 *   resolveDaoKind → buildDaoMsg → doContractBroadcast → record the vote (per chain + wallet) + clearVoteCache
 *
 * Actions come from useHomeActions (single aggregator hook — no duplicate scan).
 */

import { useState } from "react"
import { Link } from "react-router-dom"
import { useOutletContext } from "react-router-dom"
import { useHomeActions } from "../../hooks/home/useHomeActions"
import { ActionDoor, ActionDoorSkeleton } from "./doors/ActionDoor"
import { Door } from "./Door"
import { buildDaoMsg, resolveDaoKind } from "../../lib/dao"
import { GNO_CHAIN_ID, GNO_RPC_URL } from "../../lib/config"
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
    // Votes recorded in this session belong to one chain and one wallet; a
    // wallet switch starts from an empty set instead of hiding its proposals.
    const scope = `${GNO_CHAIN_ID}:${userAddress ?? ""}`
    const [recorded, setRecorded] = useState<{ scope: string; ids: Set<string> }>({ scope, ids: new Set() })
    const votedIds = recorded.scope === scope ? recorded.ids : new Set<string>()
    const [voteError, setVoteError] = useState<string | null>(null)

    const handleQuickVote = async (
        realmPath: string,
        proposalId: number,
        vote: "YES" | "NO",
    ) => {
        if (!userAddress) return
        const key = `${realmPath}:${proposalId}`
        setVotingId(key)
        setVoteError(null)
        try {
            const kind = await resolveDaoKind({ rpcUrl: GNO_RPC_URL, chainId: GNO_CHAIN_ID, realmPath })
            const msg = buildDaoMsg(kind, realmPath, { type: "vote", id: proposalId, vote }, userAddress)
            await doContractBroadcast([msg], `Vote ${vote} on proposal #${proposalId}`)
            setRecorded(prev => ({ scope, ids: new Set(prev.scope === scope ? prev.ids : []).add(key) }))
            clearVoteCache()
        } catch (err) {
            setVoteError(err instanceof Error ? err.message : "The vote could not be submitted")
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

    const totalCount = actions.length

    // ── Loading ───────────────────────────────────────────────
    if (loading) {
        return (
            <section className="action-inbox" aria-label="Act now">
                <div className="action-inbox__header">
                    <h2 className="action-inbox__title">Act now</h2>
                </div>
                <div className="action-inbox__list">
                    <ActionDoorSkeleton />
                    <ActionDoorSkeleton />
                    <ActionDoorSkeleton />
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
                    <Door variant="action" state="ready" eyebrow="all caught up">
                        <span className="action-door__caught-up-msg">
                            {"You're all caught up."}
                        </span>
                        <Link
                            to={buildPath("dao")}
                            className="action-door__caught-up-link"
                        >
                            Browse DAOs
                        </Link>
                    </Door>
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

            {voteError && (
                <p className="action-inbox__error" role="alert">
                    Vote failed: {voteError}
                </p>
            )}

            <div className="action-inbox__list">
                {actions.map(action => (
                    <ActionDoor
                        key={action.id}
                        action={{
                            ...action,
                            href: buildPath(action.href.replace(/^\//, "")),
                        }}
                        votingId={votingId}
                        votedIds={votedIds}
                        unvotedProposals={visibleUnvoted}
                        onVote={handleQuickVote}
                    />
                ))}
            </div>

            <div className="action-inbox__footer">
                <Link
                    to={buildPath("alerts")}
                    className="action-inbox__view-all"
                >
                    view all activity →
                </Link>
            </div>
        </section>
    )
}
