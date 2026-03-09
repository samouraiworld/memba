/**
 * DAOGovernance — 10s animated DAO proposal + vote lifecycle.
 *
 * Matches real ProposalCard.tsx layout: #id + title, author,
 * status badge (ACTIVE/PASSED), SingleVoteBar (14px, green/red with threshold).
 */
import { useCurrentFrame, interpolate, spring, useVideoConfig } from "remotion"
import { MockUI, MockCard, MockButton } from "../components/MockUI"
import { COLORS, fontMono } from "../components/tokens"

export function DAOGovernance() {
    const frame = useCurrentFrame()
    const { fps } = useVideoConfig()

    // Timeline: 0-45 card, 45-180 vote bar fills, 180-240 vote cast, 240-300 passed
    const cardAppear = spring({ frame, fps, config: { damping: 15 } })
    const totalMembers = 17
    const yesVotes = interpolate(frame, [45, 180], [0, 12], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
    const noVotes = interpolate(frame, [80, 160], [0, 3], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
    const totalVoted = Math.round(yesVotes) + Math.round(noVotes)
    const participationPct = totalMembers > 0 ? Math.min((totalVoted / totalMembers) * 100, 100) : 0
    const yesFraction = totalVoted > 0 ? (Math.round(yesVotes) / totalVoted) * 100 : 0
    const noFraction = totalVoted > 0 ? (Math.round(noVotes) / totalVoted) * 100 : 0

    const voteCast = frame > 190
    const passed = frame > 260

    // Real status colors from ProposalCard.tsx
    const statusBg = passed ? "rgba(76,175,80,0.08)" : "rgba(0,212,170,0.08)"
    const statusColor = passed ? "#4caf50" : COLORS.accent
    const statusLabel = passed ? "PASSED" : "ACTIVE"

    return (
        <MockUI title="GovDAO">
            {/* ProposalCard layout — matches real component */}
            <div style={{ opacity: cardAppear }}>
                <MockCard>
                    {/* Header: #id + title + status badge */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 6 }}>
                        <div style={{ flex: 1 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 2 }}>
                                <span style={{ fontSize: 7, fontFamily: fontMono, color: "#555", fontWeight: 500 }}>
                                    #42
                                </span>
                                <span style={{ fontSize: 9, fontWeight: 600, color: COLORS.text }}>
                                    Upgrade Core Libraries
                                </span>
                            </div>
                            {/* Author row */}
                            <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 3 }}>
                                <span style={{ fontSize: 7, fontFamily: fontMono, color: COLORS.accent }}>
                                    g1jg8m...k9x2
                                </span>
                                <span style={{
                                    padding: "0px 3px", borderRadius: 2, fontSize: 6,
                                    fontFamily: fontMono, fontWeight: 600,
                                    background: "rgba(255,255,255,0.04)", color: "#888",
                                }}>
                                    T1
                                </span>
                            </div>
                        </div>
                        {/* Status badge — exact ProposalCard.tsx statusColors */}
                        <span style={{
                            padding: "2px 6px", borderRadius: 4, fontSize: 7,
                            fontFamily: fontMono, fontWeight: 600, whiteSpace: "nowrap",
                            background: statusBg, color: statusColor,
                        }}>
                            {statusLabel}
                        </span>
                    </div>

                    {/* SingleVoteBar — exact match: 14px height, green/red split, threshold marker */}
                    <div style={{ display: "flex", flexDirection: "column", gap: 3, marginTop: 8 }}>
                        {/* Vote counts */}
                        <div style={{ display: "flex", gap: 6, fontSize: 7, fontFamily: fontMono, color: "#666" }}>
                            <span style={{ color: "#4caf50" }}>✓ {Math.round(yesVotes)}</span>
                            <span style={{ color: "#f44336" }}>✗ {Math.round(noVotes)}</span>
                        </div>
                        {/* SingleVoteBar */}
                        <div style={{
                            height: 10, background: "rgba(255,255,255,0.04)",
                            borderRadius: 5, overflow: "hidden", position: "relative",
                        }}>
                            {/* Filled: participation %, split into YES green + NO red */}
                            <div style={{
                                width: `${participationPct}%`, height: "100%",
                                display: "flex", transition: "width 0.1s",
                            }}>
                                <div style={{ width: `${yesFraction}%`, height: "100%", background: "#4caf50" }} />
                                <div style={{ width: `${noFraction}%`, height: "100%", background: "#f44336" }} />
                            </div>
                            {/* Threshold marker at 50% — white line */}
                            <div style={{
                                position: "absolute", top: 0, left: "50%",
                                width: 1, height: "100%",
                                background: "rgba(255,255,255,0.2)",
                            }} />
                        </div>
                    </div>
                </MockCard>
            </div>

            {/* Vote action area */}
            <div style={{ display: "flex", gap: 6, justifyContent: "center", marginTop: 4 }}>
                {!voteCast ? (
                    <>
                        <MockButton variant="primary">✓ YES</MockButton>
                        <MockButton variant="ghost">✗ NO</MockButton>
                    </>
                ) : (
                    <div style={{
                        display: "flex", alignItems: "center", gap: 4,
                        opacity: spring({ frame: frame - 190, fps, config: { damping: 12 } }),
                    }}>
                        {/* Matches ProposalCard voted badge */}
                        <span style={{
                            padding: "2px 6px", borderRadius: 4, fontSize: 7,
                            fontFamily: fontMono, fontWeight: 600,
                            background: "rgba(76,175,80,0.08)", color: "#4caf50",
                        }}>
                            ✓ VOTED
                        </span>
                    </div>
                )}
            </div>
        </MockUI>
    )
}
