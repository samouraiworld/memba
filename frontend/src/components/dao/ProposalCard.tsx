/**
 * ProposalCard — DAO proposal summary card with vote progress bar.
 *
 * Contains co-located VoteBar component.
 * Extracted in v1.5.0 from DAOHome.tsx.
 */
import type { DAOProposal } from "../../lib/dao/shared"

function VoteBar({ yesPercent, noPercent }: { yesPercent: number; noPercent: number }) {
    return (
        <div style={{ height: 4, background: "#1a1a1a", borderRadius: 2, overflow: "hidden", display: "flex" }}>
            <div style={{ width: `${yesPercent}%`, background: "#4caf50", transition: "width 0.3s" }} />
            <div style={{ width: `${noPercent}%`, background: "#f44336", transition: "width 0.3s" }} />
        </div>
    )
}

export function ProposalCard({ proposal, hasVoted, isMember, enriched, totalMembers, onClick }: {
    proposal: DAOProposal; hasVoted: boolean; isMember: boolean; enriched: boolean; totalMembers: number; onClick: () => void
}) {
    const statusColors: Record<string, { bg: string; color: string; label: string }> = {
        open: { bg: "rgba(0,212,170,0.08)", color: "#00d4aa", label: "ACTIVE" },
        passed: { bg: "rgba(76,175,80,0.08)", color: "#4caf50", label: "PASSED" },
        rejected: { bg: "rgba(244,67,54,0.08)", color: "#f44336", label: "REJECTED" },
        executed: { bg: "rgba(33,150,243,0.08)", color: "#2196f3", label: "EXECUTED" },
    }
    const sc = statusColors[proposal.status] || statusColors.open

    return (
        <div
            className="k-card"
            onClick={onClick}
            style={{ padding: "16px 20px", cursor: "pointer", transition: "border-color 0.15s" }}
            onMouseEnter={(e) => (e.currentTarget.style.borderColor = "#333")}
            onMouseLeave={(e) => (e.currentTarget.style.borderColor = "")}
        >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 10, fontFamily: "JetBrains Mono, monospace", color: "#555", fontWeight: 500 }}>
                            #{proposal.id}
                        </span>
                        <span style={{ fontSize: 14, fontWeight: 600, color: "#f0f0f0" }}>
                            {proposal.title}
                        </span>
                    </div>

                    {/* Author + Tiers row */}
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
                        {proposal.author && (
                            <span style={{ fontSize: 10, fontFamily: "JetBrains Mono, monospace", color: "#00d4aa" }}>
                                {proposal.author}
                            </span>
                        )}
                        {proposal.tiers.length > 0 && (
                            <div style={{ display: "flex", gap: 3 }}>
                                {proposal.tiers.map((t) => (
                                    <span key={t} style={{
                                        padding: "1px 5px", borderRadius: 3, fontSize: 8,
                                        fontFamily: "JetBrains Mono, monospace", fontWeight: 600,
                                        background: "rgba(255,255,255,0.04)", color: "#888",
                                    }}>
                                        {t}
                                    </span>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                <div style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
                    {/* Voted / Needs Vote badge */}
                    {proposal.status === "open" && isMember && enriched && (
                        hasVoted ? (
                            <span style={{
                                padding: "4px 8px", borderRadius: 6, fontSize: 9,
                                fontFamily: "JetBrains Mono, monospace", fontWeight: 600,
                                background: "rgba(76,175,80,0.08)", color: "#4caf50",
                            }}>
                                ✓ VOTED
                            </span>
                        ) : (
                            <span style={{
                                padding: "4px 8px", borderRadius: 6, fontSize: 9,
                                fontFamily: "JetBrains Mono, monospace", fontWeight: 600,
                                background: "rgba(245,166,35,0.08)", color: "#f5a623",
                            }}>
                                ⏳ VOTE
                            </span>
                        )
                    )}
                    <span style={{
                        padding: "4px 10px", borderRadius: 6, fontSize: 10,
                        fontFamily: "JetBrains Mono, monospace", fontWeight: 600,
                        background: sc.bg, color: sc.color, whiteSpace: "nowrap",
                    }}>
                        {sc.label}
                    </span>
                </div>
            </div>

            {/* Vote percentage bar */}
            {(proposal.yesPercent > 0 || proposal.noPercent > 0 || proposal.yesVotes > 0) && (
                <div style={{ marginTop: 10 }}>
                    <div style={{ display: "flex", gap: 12, fontSize: 10, fontFamily: "JetBrains Mono, monospace", color: "#666", marginBottom: 4 }}>
                        {proposal.yesPercent > 0 ? (
                            <>
                                <span style={{ color: "#4caf50" }}>✓ {proposal.yesPercent}%</span>
                                <span style={{ color: "#f44336" }}>✗ {proposal.noPercent}%</span>
                            </>
                        ) : (
                            <>
                                <span>✓ {proposal.yesVotes}</span>
                                <span>✗ {proposal.noVotes}</span>
                                {proposal.abstainVotes > 0 && <span>○ {proposal.abstainVotes}</span>}
                            </>
                        )}
                    </div>
                    <VoteBar
                        yesPercent={proposal.yesPercent || (proposal.yesVotes + proposal.noVotes > 0 ? (proposal.yesVotes / (proposal.yesVotes + proposal.noVotes)) * 100 : 0)}
                        noPercent={proposal.noPercent || (proposal.yesVotes + proposal.noVotes > 0 ? (proposal.noVotes / (proposal.yesVotes + proposal.noVotes)) * 100 : 0)}
                    />
                </div>
            )}

            {/* Voter turnout */}
            {enriched && totalMembers > 0 && proposal.totalVoters > 0 && (
                <div style={{ marginTop: 4, fontSize: 9, fontFamily: "JetBrains Mono, monospace", color: "#555" }}>
                    {proposal.totalVoters} of {totalMembers} members voted ({Math.round((proposal.totalVoters / totalMembers) * 100)}%)
                </div>
            )}
        </div>
    )
}
