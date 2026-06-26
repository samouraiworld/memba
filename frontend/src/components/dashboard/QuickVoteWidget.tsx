/**
 * QuickVoteWidget — Inline voting for unvoted DAO proposals.
 * Extracted from Dashboard.tsx for maintainability.
 */
import { useNetworkNav } from "../../hooks/useNetworkNav"
import type { UnvotedProposal } from "../../lib/dao/voteScanner"
import "../home/home.css"

interface Props {
    proposals: UnvotedProposal[]
    votingId: string | null
    votedIds: Set<string>
    onVote: (realmPath: string, proposalId: number, vote: "YES" | "NO") => void
}

export function QuickVoteWidget({ proposals, votingId, votedIds, onVote }: Props) {
    const navigate = useNetworkNav()

    if (proposals.length === 0) return null

    return (
        <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                <span style={{ fontSize: 14 }}>🗳️</span>
                <h3 style={{ fontSize: 14, fontWeight: 500 }}>Quick Vote</h3>
                <span className="k-label" style={{ marginLeft: "auto" }}>
                    {proposals.length} pending
                </span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {proposals.map(p => {
                    const key = `${p.realmPath}:${p.proposalId}`
                    const isVoting = votingId === key
                    const hasVoted = votedIds.has(key)
                    return (
                        <div key={key} className="k-card quick-vote-card" style={{
                            padding: "14px 18px", display: "flex", alignItems: "center", gap: 12,
                            flexWrap: "wrap",
                            borderColor: hasVoted ? "var(--color-k-accent-border)" : "var(--color-k-edge)",
                            opacity: hasVoted ? 0.6 : 1,
                        }}>
                            <div style={{ flex: 1, minWidth: 160 }}>
                                <div style={{ fontSize: 11, fontFamily: "JetBrains Mono, monospace", color: "var(--color-k-dim)", marginBottom: 2 }}>
                                    {p.daoName}
                                </div>
                                <div
                                    style={{ fontSize: 13, fontWeight: 500, cursor: "pointer", color: "var(--color-k-text)" }}
                                    onClick={() => navigate(`/dao/${p.daoSlug}/proposal/${p.proposalId}`)}
                                >
                                    #{p.proposalId} — {p.proposalTitle.length > 50 ? p.proposalTitle.slice(0, 50) + "…" : p.proposalTitle}
                                </div>
                            </div>
                            {hasVoted ? (
                                <span style={{ fontSize: 11, fontFamily: "JetBrains Mono, monospace", color: "var(--color-k-accent-text)" }}>
                                    ✓ Voted
                                </span>
                            ) : (
                                <div style={{ display: "flex", gap: 6 }}>
                                    <button
                                        onClick={() => onVote(p.realmPath, p.proposalId, "YES")}
                                        disabled={isVoting}
                                        aria-label={`Vote YES on proposal ${p.proposalId}`}
                                        className="quick-vote-btn quick-vote-btn--yes"
                                        style={{
                                            cursor: isVoting ? "default" : "pointer",
                                            opacity: isVoting ? 0.5 : 1,
                                        }}
                                    >
                                        {isVoting ? "..." : "✓ YES"}
                                    </button>
                                    <button
                                        onClick={() => onVote(p.realmPath, p.proposalId, "NO")}
                                        disabled={isVoting}
                                        aria-label={`Vote NO on proposal ${p.proposalId}`}
                                        className="quick-vote-btn quick-vote-btn--no"
                                        style={{
                                            cursor: isVoting ? "default" : "pointer",
                                            opacity: isVoting ? 0.5 : 1,
                                        }}
                                    >
                                        {isVoting ? "..." : "✗ NO"}
                                    </button>
                                    <button
                                        onClick={() => onVote(p.realmPath, p.proposalId, "ABSTAIN" as "YES" | "NO")}
                                        disabled={isVoting}
                                        aria-label={`Abstain on proposal ${p.proposalId}`}
                                        className="quick-vote-btn quick-vote-btn--abstain"
                                        style={{
                                            cursor: isVoting ? "default" : "pointer",
                                            opacity: isVoting ? 0.5 : 1,
                                        }}
                                    >
                                        {isVoting ? "..." : "— ABSTAIN"}
                                    </button>
                                </div>
                            )}
                        </div>
                    )
                })}
            </div>
        </div>
    )
}
