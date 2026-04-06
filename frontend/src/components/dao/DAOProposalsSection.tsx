import { useState } from "react"
import { useNetworkNav } from "../../hooks/useNetworkNav"
import { SkeletonCard } from "../ui/LoadingSkeleton"
import { ProposalCard } from "./ProposalCard"
import type { DAOProposal } from "../../lib/dao"

interface DAOProposalsSectionProps {
    encodedSlug: string
    realmPath: string
    isAuthenticated: boolean
    isArchived: boolean
    isMember: boolean
    memberCount: number
    activeProposals: DAOProposal[]
    completedProposals: DAOProposal[]
    votedIds: Set<number>
    enrichedIds: Set<number>
    proposalsLoading: boolean
}

export function DAOProposalsSection({
    encodedSlug, realmPath, isAuthenticated, isArchived, isMember, memberCount,
    activeProposals, completedProposals, votedIds, enrichedIds, proposalsLoading,
}: DAOProposalsSectionProps) {
    const navigate = useNetworkNav()
    const [voteFilter, setVoteFilter] = useState<"all" | "needs" | "voted">("all")
    const [showHistory, setShowHistory] = useState(false)

    return (
        <>
            <div id="dao-proposals-section">
                <div className="dao-section-header">
                    <h3 className="dao-section-title">Active Proposals</h3>
                    {isAuthenticated && !isArchived && (
                        <button
                            className="k-btn-primary dao-new-proposal-btn"
                            onClick={() => navigate(`/dao/${encodedSlug}/propose`)}
                        >
                            + New Proposal
                        </button>
                    )}
                </div>

                {/* Filter tabs (only for members with active proposals) */}
                {isAuthenticated && isMember && activeProposals.length > 0 && (
                    <div className="dao-filter-tabs">
                        {(["all", "needs", "voted"] as const).map(f => {
                            const count = f === "all" ? activeProposals.length
                                : f === "needs" ? activeProposals.filter(p => p.status === "open" && !votedIds.has(p.id)).length
                                    : activeProposals.filter(p => votedIds.has(p.id)).length
                            const labels = { all: "All", needs: "Needs My Vote", voted: "Voted" }
                            return (
                                <button
                                    key={f}
                                    onClick={() => setVoteFilter(f)}
                                    className={`dao-filter-tab${voteFilter === f ? " active" : ""}`}
                                >
                                    {labels[f]} ({count})
                                </button>
                            )
                        })}
                    </div>
                )}

                {proposalsLoading ? (
                    <div className="dao-list-col">
                        <SkeletonCard />
                        <SkeletonCard />
                    </div>
                ) : activeProposals.length === 0 ? (
                    <div className="k-dashed dao-empty">
                        <p>No active proposals</p>
                    </div>
                ) : (
                    <div className="dao-list-col">
                        {activeProposals
                            .filter(p => {
                                if (voteFilter === "needs") return p.status === "open" && !votedIds.has(p.id)
                                if (voteFilter === "voted") return votedIds.has(p.id)
                                return true
                            })
                            .map((p) => (
                                <ProposalCard
                                    key={p.id}
                                    proposal={p}
                                    hasVoted={votedIds.has(p.id)}
                                    isMember={isMember}
                                    enriched={enrichedIds.has(p.id)}
                                    totalMembers={memberCount}
                                    realmPath={realmPath}
                                    onClick={() => navigate(`/dao/${encodedSlug}/proposal/${p.id}`)}
                                />
                            ))}
                    </div>
                )}
            </div>

            {/* Proposal History (collapsible) */}
            {!proposalsLoading && completedProposals.length > 0 && (
                <div>
                    <button
                        onClick={() => setShowHistory(!showHistory)}
                        className="dao-history-toggle"
                    >
                        <span className={`dao-history-arrow${showHistory ? " open" : ""}`}>▶</span>
                        Past Proposals ({completedProposals.length})
                    </button>
                    {showHistory && (
                        <div className="animate-fade-in dao-list-col" style={{ marginTop: 8 }}>
                            {completedProposals.map((p) => (
                                <ProposalCard key={p.id} proposal={p} hasVoted={votedIds.has(p.id)} isMember={isMember} enriched={true} totalMembers={memberCount} realmPath={realmPath} onClick={() => navigate(`/dao/${encodedSlug}/proposal/${p.id}`)} />
                            ))}
                        </div>
                    )}
                </div>
            )}
        </>
    )
}
