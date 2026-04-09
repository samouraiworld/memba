/**
 * ProposalCard — DAO proposal summary card with dual vote bar.
 *
 * Contains co-located DualVoteBar component:
 *   - Top bar: 3-color vote split (YES green / NO red / ABSTAIN grey)
 *   - Bottom bar: quorum progress with threshold marker
 *
 * Extracted in v1.5.0 from DAOHome.tsx. Redesigned in v1.7.0.
 */
import { type DAOProposal, PROPOSAL_STATUS_COLORS } from "../../lib/dao/shared"
import { useProposalDate } from "../../hooks/useProposalDate"

/**
 * SingleVoteBar — Single-line bar showing participation and vote split.
 *
 * Filled width = participation %. Within the filled portion:
 * green = YES, red = NO. Unfilled = not yet voted (grey).
 * Threshold marker as a thin white line.
 */
function SingleVoteBar({ yesVotes, noVotes, totalMembers, threshold }: {
    yesVotes: number; noVotes: number; totalMembers: number; threshold?: number
}) {
    const totalVoted = yesVotes + noVotes
    if (totalVoted === 0 && totalMembers === 0) return null

    // Participation as % of total members
    const participationPct = totalMembers > 0 ? Math.min((totalVoted / totalMembers) * 100, 100) : 0

    // Within voted portion: YES/NO split
    const yesFraction = totalVoted > 0 ? (yesVotes / totalVoted) * 100 : 0
    const noFraction = totalVoted > 0 ? (noVotes / totalVoted) * 100 : 0

    // Threshold position (default 50%)
    const thresholdPct = threshold ?? 50

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {/* Vote counts */}
            <div style={{ display: "flex", gap: 10, fontSize: 12, fontFamily: "JetBrains Mono, monospace", color: "var(--color-text-secondary)" }}>
                <span style={{ color: "var(--color-success)" }}>✓ {yesVotes}</span>
                <span style={{ color: "var(--color-danger)" }}>✗ {noVotes}</span>
            </div>
            {/* Single bar */}
            <div
                role="progressbar"
                aria-valuenow={Math.round(participationPct)}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`${Math.round(participationPct)}% voted — ${yesVotes} yes, ${noVotes} no`}
                style={{ height: 14, background: "rgba(255,255,255,0.04)", borderRadius: 7, overflow: "hidden", position: "relative" }}
            >
                {/* Filled portion = participation %, split into YES (green) + NO (red) */}
                <div style={{ width: `${participationPct}%`, height: "100%", display: "flex", transition: "width 0.4s ease" }}>
                    <div style={{
                        width: `${yesFraction}%`, height: "100%",
                        background: "#4caf50", transition: "width 0.3s",
                    }} />
                    <div style={{
                        width: `${noFraction}%`, height: "100%",
                        background: "#f44336", transition: "width 0.3s",
                    }} />
                </div>
                {/* Threshold marker */}
                <div style={{
                    position: "absolute", top: 0, left: `${thresholdPct}%`,
                    width: 1, height: "100%",
                    background: "rgba(255,255,255,0.2)",
                }} />
            </div>
        </div>
    )
}

export function ProposalCard({ proposal, hasVoted, isMember, enriched, totalMembers, realmPath, onClick }: {
    proposal: DAOProposal; hasVoted: boolean; isMember: boolean; enriched: boolean; totalMembers: number; realmPath?: string; onClick: () => void
}) {
    const sc = PROPOSAL_STATUS_COLORS[proposal.status] || PROPOSAL_STATUS_COLORS.open
    const { timestamp } = useProposalDate(realmPath, proposal.id, proposal.createdAt, proposal.createdAtBlock)

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
                        <span style={{ fontSize: 10, fontFamily: "JetBrains Mono, monospace", color: "var(--color-text-muted)", fontWeight: 500 }}>
                            #{proposal.id}
                        </span>
                        <span style={{ fontSize: 14, fontWeight: 600, color: "var(--color-text)" }}>
                            {proposal.title}
                        </span>
                    </div>

                    {/* Author + Tiers + Date row */}
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
                        {proposal.author && (
                            <span style={{ fontSize: 10, fontFamily: "JetBrains Mono, monospace", color: "var(--color-primary)" }}>
                                {proposal.author}
                            </span>
                        )}
                        {proposal.tiers.length > 0 && (
                            <div style={{ display: "flex", gap: 3 }}>
                                {proposal.tiers.map((t) => (
                                    <span key={t} style={{
                                        padding: "1px 5px", borderRadius: 3, fontSize: 8,
                                        fontFamily: "JetBrains Mono, monospace", fontWeight: 600,
                                        background: "rgba(255,255,255,0.04)", color: "var(--color-text-secondary)",
                                    }}>
                                        {t}
                                    </span>
                                ))}
                            </div>
                        )}
                        {/* v3.2: Estimated creation date */}
                        {timestamp && (
                            <span
                                style={{ fontSize: 10, fontFamily: "JetBrains Mono, monospace", color: "var(--color-text-muted)" }}
                                title={timestamp.block ? `Block #${timestamp.block}` : undefined}
                            >
                                · {timestamp.label}
                            </span>
                        )}
                    </div>
                </div>

                <div style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
                    {/* v2.13: Awaiting Execution badge — passed proposals ready for on-chain execution */}
                    {proposal.status === "passed" && (
                        <span style={{
                            padding: "4px 8px", borderRadius: 6, fontSize: 9,
                            fontFamily: "JetBrains Mono, monospace", fontWeight: 600,
                            background: "rgba(245,166,35,0.1)", color: "var(--color-warning)",
                            animation: "pulse-dot 2s ease-in-out infinite",
                        }}>
                            ⚡ EXECUTE
                        </span>
                    )}
                    {/* Voted / Needs Vote badge */}
                    {proposal.status === "open" && isMember && enriched && (
                        hasVoted ? (
                            <span style={{
                                padding: "4px 8px", borderRadius: 6, fontSize: 9,
                                fontFamily: "JetBrains Mono, monospace", fontWeight: 600,
                                background: "rgba(76,175,80,0.08)", color: "var(--color-success)",
                            }}>
                                ✓ VOTED
                            </span>
                        ) : (
                            <span style={{
                                padding: "4px 8px", borderRadius: 6, fontSize: 9,
                                fontFamily: "JetBrains Mono, monospace", fontWeight: 600,
                                background: "rgba(245,166,35,0.08)", color: "var(--color-warning)",
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

            {/* Single Vote Bar: participation + vote split */}
            {(proposal.yesVotes > 0 || proposal.noVotes > 0 || proposal.yesPercent > 0) && (
                <div style={{ marginTop: 10 }}>
                    <SingleVoteBar
                        yesVotes={proposal.yesVotes || (proposal.yesPercent > 0 ? Math.round(proposal.yesPercent) : 0)}
                        noVotes={proposal.noVotes || (proposal.noPercent > 0 ? Math.round(proposal.noPercent) : 0)}
                        totalMembers={totalMembers}
                    />
                </div>
            )}

            {/* Voter turnout */}
            {enriched && totalMembers > 0 && proposal.totalVoters > 0 && (
                <div style={{ marginTop: 4, fontSize: 9, fontFamily: "JetBrains Mono, monospace", color: "var(--color-text-muted)" }}>
                    {proposal.totalVoters} of {totalMembers} members voted ({Math.round((proposal.totalVoters / totalMembers) * 100)}%)
                </div>
            )}
        </div>
    )
}

