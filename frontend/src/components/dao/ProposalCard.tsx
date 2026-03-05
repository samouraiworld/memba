/**
 * ProposalCard — DAO proposal summary card with dual vote bar.
 *
 * Contains co-located DualVoteBar component:
 *   - Top bar: 3-color vote split (YES green / NO red / ABSTAIN grey)
 *   - Bottom bar: quorum progress with threshold marker
 *
 * Extracted in v1.5.0 from DAOHome.tsx. Redesigned in v1.7.0.
 */
import type { DAOProposal } from "../../lib/dao/shared"

/**
 * DualVoteBar — replaces old VoteBar which only showed YES/(YES+NO).
 *
 * Top: vote split across YES/NO/ABSTAIN (all 3 types visible)
 * Bottom: participation % with optional quorum threshold marker
 */
function DualVoteBar({ yesVotes, noVotes, abstainVotes, totalMembers }: {
    yesVotes: number; noVotes: number; abstainVotes: number; totalMembers: number
}) {
    const totalVoted = yesVotes + noVotes + abstainVotes
    if (totalVoted === 0) return null

    // Vote split percentages (of those who voted)
    const yesPct = (yesVotes / totalVoted) * 100
    const noPct = (noVotes / totalVoted) * 100
    const abstainPct = (abstainVotes / totalVoted) * 100

    // Quorum: participation % of total members
    const quorumPct = totalMembers > 0 ? Math.min((totalVoted / totalMembers) * 100, 100) : 0

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {/* Vote Split Bar */}
            <div>
                <div style={{ display: "flex", gap: 10, fontSize: 10, fontFamily: "JetBrains Mono, monospace", color: "#666", marginBottom: 3 }}>
                    <span style={{ color: "#4caf50" }}>✓ {yesVotes}</span>
                    <span style={{ color: "#f44336" }}>✗ {noVotes}</span>
                    {abstainVotes > 0 && <span style={{ color: "#666" }}>○ {abstainVotes}</span>}
                </div>
                <div style={{ height: 4, background: "#1a1a1a", borderRadius: 2, overflow: "hidden", display: "flex" }}>
                    <div style={{ width: `${yesPct}%`, background: "#4caf50", transition: "width 0.3s" }} />
                    <div style={{ width: `${noPct}%`, background: "#f44336", transition: "width 0.3s" }} />
                    {abstainPct > 0 && (
                        <div style={{ width: `${abstainPct}%`, background: "#555", transition: "width 0.3s" }} />
                    )}
                </div>
            </div>

            {/* Quorum Progress Bar (only if totalMembers known) */}
            {totalMembers > 0 && (
                <div style={{ position: "relative" }}>
                    <div style={{ height: 3, background: "#1a1a1a", borderRadius: 2, overflow: "hidden" }}>
                        <div style={{
                            width: `${quorumPct}%`,
                            background: quorumPct >= 50 ? "rgba(0,212,170,0.5)" : "rgba(245,166,35,0.4)",
                            transition: "width 0.3s",
                            height: "100%",
                        }} />
                    </div>
                    {/* 50% quorum threshold marker */}
                    <div style={{
                        position: "absolute", top: -1, left: "50%",
                        width: 1, height: 5,
                        background: "rgba(255,255,255,0.15)",
                        borderRadius: 1,
                    }} />
                </div>
            )}
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

            {/* Dual Vote Bar: vote split + quorum progress */}
            {(proposal.yesVotes > 0 || proposal.noVotes > 0 || proposal.abstainVotes > 0 || proposal.yesPercent > 0) && (
                <div style={{ marginTop: 10 }}>
                    <DualVoteBar
                        yesVotes={proposal.yesVotes || (proposal.yesPercent > 0 ? Math.round(proposal.yesPercent) : 0)}
                        noVotes={proposal.noVotes || (proposal.noPercent > 0 ? Math.round(proposal.noPercent) : 0)}
                        abstainVotes={proposal.abstainVotes}
                        totalMembers={totalMembers}
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

