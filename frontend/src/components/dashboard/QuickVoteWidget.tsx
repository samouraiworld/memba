/**
 * QuickVoteWidget — Inline voting for unvoted DAO proposals.
 * Extracted from Dashboard.tsx for maintainability.
 */
import { useNetworkNav } from "../../hooks/useNetworkNav"
import type { UnvotedProposal } from "../../lib/dao/voteScanner"

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
                        <div key={key} className="k-card" style={{
                            padding: "14px 18px", display: "flex", alignItems: "center", gap: 12,
                            flexWrap: "wrap",
                            borderColor: hasVoted ? "rgba(0,212,170,0.2)" : "#222",
                            opacity: hasVoted ? 0.6 : 1,
                        }}>
                            <div style={{ flex: 1, minWidth: 160 }}>
                                <div style={{ fontSize: 11, fontFamily: "JetBrains Mono, monospace", color: "#666", marginBottom: 2 }}>
                                    {p.daoName}
                                </div>
                                <div
                                    style={{ fontSize: 13, fontWeight: 500, cursor: "pointer", color: "#f0f0f0" }}
                                    onClick={() => navigate(`/dao/${p.daoSlug}/proposal/${p.proposalId}`)}
                                >
                                    #{p.proposalId} — {p.proposalTitle.length > 50 ? p.proposalTitle.slice(0, 50) + "…" : p.proposalTitle}
                                </div>
                            </div>
                            {hasVoted ? (
                                <span style={{ fontSize: 11, fontFamily: "JetBrains Mono, monospace", color: "#00d4aa" }}>
                                    ✓ Voted
                                </span>
                            ) : (
                                <div style={{ display: "flex", gap: 6 }}>
                                    <button
                                        onClick={() => onVote(p.realmPath, p.proposalId, "YES")}
                                        disabled={isVoting}
                                        aria-label={`Vote YES on proposal ${p.proposalId}`}
                                        style={{
                                            padding: "6px 14px", borderRadius: 6, fontSize: 11,
                                            fontFamily: "JetBrains Mono, monospace", fontWeight: 600,
                                            background: "rgba(0,212,170,0.1)", color: "#00d4aa",
                                            border: "1px solid rgba(0,212,170,0.25)", cursor: isVoting ? "default" : "pointer",
                                            opacity: isVoting ? 0.5 : 1, transition: "all 0.15s",
                                        }}
                                    >
                                        {isVoting ? "..." : "✓ YES"}
                                    </button>
                                    <button
                                        onClick={() => onVote(p.realmPath, p.proposalId, "NO")}
                                        disabled={isVoting}
                                        aria-label={`Vote NO on proposal ${p.proposalId}`}
                                        style={{
                                            padding: "6px 14px", borderRadius: 6, fontSize: 11,
                                            fontFamily: "JetBrains Mono, monospace", fontWeight: 600,
                                            background: "rgba(255,71,87,0.08)", color: "#ff4757",
                                            border: "1px solid rgba(255,71,87,0.2)", cursor: isVoting ? "default" : "pointer",
                                            opacity: isVoting ? 0.5 : 1, transition: "all 0.15s",
                                        }}
                                    >
                                        {isVoting ? "..." : "✗ NO"}
                                    </button>
                                    <button
                                        onClick={() => onVote(p.realmPath, p.proposalId, "ABSTAIN" as "YES" | "NO")}
                                        disabled={isVoting}
                                        aria-label={`Abstain on proposal ${p.proposalId}`}
                                        style={{
                                            padding: "6px 14px", borderRadius: 6, fontSize: 11,
                                            fontFamily: "JetBrains Mono, monospace", fontWeight: 600,
                                            background: "rgba(255,255,255,0.04)", color: "#888",
                                            border: "1px solid rgba(255,255,255,0.08)", cursor: isVoting ? "default" : "pointer",
                                            opacity: isVoting ? 0.5 : 1, transition: "all 0.15s",
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
