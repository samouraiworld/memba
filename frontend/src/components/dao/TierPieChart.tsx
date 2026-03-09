/**
 * TierPieChart — SVG donut chart showing tier distribution.
 *
 * Used in two modes:
 * - "power": Power distribution overview on DAOHome (tier allocations)
 * - "votes": Vote breakdown on ProposalView (per-tier YES/NO/ABSTAIN)
 *
 * Also exports VotingInsights — full 3-layer card for ProposalView:
 * 1. Participation (quorum ring)
 * 2. Vote Split (YES/NO/ABSTAIN bar)
 * 3. Tier Breakdown (donut + legend)
 *
 * v2.1: Complete rewrite with premium design, quorum integration, animation.
 */

import type { VoteRecord, TierInfo } from "../../lib/dao/shared"

// ── Color palette ──────────────────────────────────────────
const TIER_COLORS: Record<string, string> = {
    T1: "#00d4aa",
    T2: "#7b61ff",
    T3: "#f5a623",
    T4: "#3b82f6",
    T5: "#ef4444",
    T6: "#8b5cf6",
}
const YES_COLOR = "#4caf50"
const NO_COLOR = "#f44336"
const ABSTAIN_COLOR = "#555"

function tierColor(tier: string, idx: number): string {
    return TIER_COLORS[tier.toUpperCase()] || ["#00d4aa", "#7b61ff", "#f5a623", "#3b82f6", "#ef4444"][idx % 5]
}

// ── Shared SVG donut renderer ────────────────────────────
interface DonutSegment {
    key: string
    value: number
    color: string
    label: string
}

function DonutChart({ segments, size, centerLabel, centerSub }: {
    segments: DonutSegment[]
    size: number
    centerLabel: string
    centerSub?: string
}) {
    const total = segments.reduce((s, sg) => s + sg.value, 0)
    if (total === 0) return null

    const strokeWidth = size * 0.18
    const pad = strokeWidth / 2 + 6   // half-stroke + glow clearance
    const radius = size / 2 - pad
    const cx = size / 2
    const cy = size / 2
    const circumference = 2 * Math.PI * radius

    // Pre-compute prefix sums for rotation offsets (avoids mutation during render)
    const visibleSegments = segments.filter(s => s.value > 0)
    const prefixPcts = visibleSegments.reduce<number[]>((acc, seg, i) => {
        const prev = i > 0 ? acc[i - 1] : 0
        acc.push(prev + seg.value / total)
        return acc
    }, [])

    return (
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flexShrink: 0, overflow: "visible" }}>
            {/* Background ring */}
            <circle cx={cx} cy={cy} r={radius} fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth={strokeWidth} />
            {visibleSegments.map((seg, i) => {
                const pct = seg.value / total
                const dashLen = pct * circumference
                const gapLen = circumference - dashLen
                const offset = i > 0 ? prefixPcts[i - 1] : 0
                const rotation = -90 + offset * 360
                return (
                    <circle
                        key={seg.key}
                        cx={cx} cy={cy} r={radius}
                        fill="none"
                        stroke={seg.color}
                        strokeWidth={strokeWidth}
                        strokeDasharray={`${dashLen} ${gapLen}`}
                        strokeDashoffset={0}
                        strokeLinecap="butt"
                        transform={`rotate(${rotation} ${cx} ${cy})`}
                        style={{ filter: `drop-shadow(0 0 4px ${seg.color}44)`, transition: "stroke-dasharray 0.6s ease" }}
                    >
                        <title>{seg.label}</title>
                    </circle>
                )
            })}
            {/* Center label */}
            <text x={cx} y={centerSub ? cy - 3 : cy} textAnchor="middle" dominantBaseline="central"
                fill="#f0f0f0" fontSize={size * 0.2} fontFamily="JetBrains Mono, monospace" fontWeight="700">
                {centerLabel}
            </text>
            {centerSub && (
                <text x={cx} y={cy + size * 0.13} textAnchor="middle" dominantBaseline="central"
                    fill="#555" fontSize={size * 0.1} fontFamily="JetBrains Mono, monospace">
                    {centerSub}
                </text>
            )}
        </svg>
    )
}

// ── TierPieChart (backward-compatible export) ────────────

export interface TierVote {
    tier: string
    yesVotes: number
    noVotes: number
}

interface TierPieProps {
    tiers: TierVote[]
    size?: number
    showLegend?: boolean
}

export function TierPieChart({ tiers, size = 48, showLegend = false }: TierPieProps) {
    const segments: DonutSegment[] = tiers
        .filter(t => t.yesVotes + t.noVotes > 0)
        .map((t, i) => ({
            key: t.tier,
            value: t.yesVotes + t.noVotes,
            color: tierColor(t.tier, i),
            label: `${t.tier}: ${t.yesVotes} YES, ${t.noVotes} NO`,
        }))

    const totalVotes = tiers.reduce((s, t) => s + t.yesVotes + t.noVotes, 0)
    if (totalVotes === 0) return null

    return (
        <div style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
            <DonutChart segments={segments} size={size} centerLabel={String(totalVotes)} />
            {showLegend && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 10px", justifyContent: "center" }}>
                    {segments.map(seg => (
                        <div key={seg.key} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                            <span style={{ width: 8, height: 8, borderRadius: "50%", flexShrink: 0, background: seg.color }} />
                            <span style={{ fontSize: 9, fontFamily: "JetBrains Mono, monospace", color: "#888" }}>{seg.key}</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}

// ── Power Distribution Donut (DAOHome) ──────────────────

export function PowerDonut({ tiers, totalPower, size = 120 }: {
    tiers: TierInfo[]; totalPower: number; size?: number
}) {
    const segments: DonutSegment[] = tiers.map((t, i) => ({
        key: t.tier,
        value: t.power,
        color: tierColor(t.tier, i),
        label: `${t.tier}: ${t.power} power, ${t.memberCount} members`,
    }))

    return (
        <div style={{ display: "flex", alignItems: "center", gap: 24, flexWrap: "wrap" }}>
            <DonutChart
                segments={segments}
                size={size}
                centerLabel={String(totalPower)}
                centerSub="power"
            />
            <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 140 }}>
                {tiers.map((t, i) => {
                    const pct = totalPower > 0 ? Math.round((t.power / totalPower) * 100) : 0
                    return (
                        <div key={t.tier} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{
                                width: 10, height: 10, borderRadius: "50%", flexShrink: 0,
                                background: tierColor(t.tier, i),
                                boxShadow: `0 0 6px ${tierColor(t.tier, i)}44`,
                            }} />
                            <div>
                                <div style={{ fontSize: 12, fontWeight: 600, color: "#f0f0f0", fontFamily: "JetBrains Mono, monospace" }}>
                                    {t.tier}
                                </div>
                                <div style={{ fontSize: 10, color: "#888", fontFamily: "JetBrains Mono, monospace" }}>
                                    {pct}% • {t.memberCount} member{t.memberCount !== 1 ? "s" : ""}
                                </div>
                            </div>
                        </div>
                    )
                })}
            </div>
        </div>
    )
}

// ── Voting Insights Card (ProposalView) ──────────────────

export function VotingInsights({ yesVotes, noVotes, abstainVotes, totalMembers, threshold, voteRecords }: {
    yesVotes: number
    noVotes: number
    abstainVotes: number
    totalMembers: number
    threshold: number  // e.g., 60
    voteRecords: VoteRecord[]
}) {
    const totalVoted = yesVotes + noVotes + abstainVotes
    const participationPct = totalMembers > 0 ? Math.min((totalVoted / totalMembers) * 100, 100) : 0
    const quorumMet = participationPct >= threshold
    const votesNeeded = Math.max(0, Math.ceil(totalMembers * threshold / 100) - totalVoted)

    // Vote percentages (of total voted)
    const yesPct = totalVoted > 0 ? (yesVotes / totalVoted) * 100 : 0
    const noPct = totalVoted > 0 ? (noVotes / totalVoted) * 100 : 0
    const abstainPct = totalVoted > 0 ? (abstainVotes / totalVoted) * 100 : 0

    // Tier donut segments (per-tier vote weight)
    const tierSegments: DonutSegment[] = voteRecords
        .filter(r => r.yesVoters.length + r.noVoters.length + r.abstainVoters.length > 0)
        .map((r, i) => ({
            key: r.tier,
            value: r.yesVoters.length + r.noVoters.length + r.abstainVoters.length,
            color: tierColor(r.tier, i),
            label: `${r.tier}: ${r.yesVoters.length} YES, ${r.noVoters.length} NO, ${r.abstainVoters.length} ABSTAIN`,
        }))

    const sectionStyle: React.CSSProperties = {
        padding: "14px 16px",
        borderRadius: 10,
        background: "rgba(255,255,255,0.015)",
        border: "1px solid rgba(255,255,255,0.04)",
    }

    const labelStyle: React.CSSProperties = {
        fontSize: 10, fontFamily: "JetBrains Mono, monospace",
        color: "#666", textTransform: "uppercase" as const, letterSpacing: 1,
        marginBottom: 10, fontWeight: 600,
    }

    return (
        <div className="k-card" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
            <h3 style={{ fontSize: 14, fontWeight: 600, color: "#f0f0f0", margin: 0, display: "flex", alignItems: "center", gap: 8 }}>
                📊 Voting Insights
            </h3>

            {/* ── Layer 1: Participation (Quorum) ────── */}
            <div style={sectionStyle}>
                <div style={labelStyle}>Participation</div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
                    <span style={{ fontSize: 12, fontFamily: "JetBrains Mono, monospace", color: "#f0f0f0", fontWeight: 600 }}>
                        {totalVoted} of {totalMembers} voted
                    </span>
                    <span style={{ fontSize: 12, fontFamily: "JetBrains Mono, monospace", color: quorumMet ? "#00d4aa" : "#f5a623", fontWeight: 700 }}>
                        {Math.round(participationPct)}%
                    </span>
                </div>
                {/* Participation bar */}
                <div style={{ height: 10, background: "rgba(255,255,255,0.04)", borderRadius: 5, overflow: "hidden", position: "relative" }}>
                    <div style={{
                        width: `${participationPct}%`, height: "100%",
                        background: quorumMet
                            ? "linear-gradient(90deg, #00d4aa, #00d4aa88)"
                            : "linear-gradient(90deg, #f5a623, #f5a62388)",
                        borderRadius: 5, transition: "width 0.6s ease",
                    }} />
                    {/* Quorum threshold marker */}
                    <div style={{
                        position: "absolute", top: -2, left: `${threshold}%`, width: 2, height: "calc(100% + 4px)",
                        background: "rgba(255,255,255,0.35)", borderRadius: 1,
                    }} />
                </div>
                {/* Quorum status */}
                <div style={{ marginTop: 6, fontSize: 10, fontFamily: "JetBrains Mono, monospace" }}>
                    {quorumMet ? (
                        <span style={{ color: "#00d4aa" }}>✅ Quorum reached (threshold: {threshold}%)</span>
                    ) : (
                        <span style={{ color: "#f5a623" }}>⚠ Quorum not met — needs {votesNeeded} more vote{votesNeeded !== 1 ? "s" : ""} (threshold: {threshold}%)</span>
                    )}
                </div>
            </div>

            {/* ── Layer 2: Vote Split ────── */}
            <div style={sectionStyle}>
                <div style={labelStyle}>Vote Split</div>
                {/* Vote counts row */}
                <div style={{ display: "flex", gap: 16, marginBottom: 6, fontSize: 12, fontFamily: "JetBrains Mono, monospace" }}>
                    <span style={{ color: YES_COLOR, fontWeight: 600 }}>✓ {yesVotes} Yes ({Math.round(yesPct)}%)</span>
                    <span style={{ color: NO_COLOR, fontWeight: 600 }}>✗ {noVotes} No ({Math.round(noPct)}%)</span>
                    {abstainVotes > 0 && (
                        <span style={{ color: ABSTAIN_COLOR, fontWeight: 600 }}>— {abstainVotes} Abstain ({Math.round(abstainPct)}%)</span>
                    )}
                </div>
                {/* 3-segment bar */}
                <div style={{ height: 14, background: "rgba(255,255,255,0.04)", borderRadius: 7, overflow: "hidden", display: "flex", position: "relative" }}>
                    {totalVoted > 0 && (
                        <>
                            <div style={{ width: `${yesPct}%`, height: "100%", background: `linear-gradient(90deg, ${YES_COLOR}, ${YES_COLOR}88)`, transition: "width 0.4s" }} />
                            <div style={{ width: `${noPct}%`, height: "100%", background: `linear-gradient(90deg, ${NO_COLOR}, ${NO_COLOR}88)`, transition: "width 0.4s" }} />
                            <div style={{ width: `${abstainPct}%`, height: "100%", background: `linear-gradient(90deg, ${ABSTAIN_COLOR}, ${ABSTAIN_COLOR}88)`, transition: "width 0.4s" }} />
                        </>
                    )}
                    {/* Threshold marker (on total vote %) */}
                    <div style={{
                        position: "absolute", top: 0, left: `${threshold}%`,
                        width: 1, height: "100%",
                        background: "rgba(255,255,255,0.25)",
                    }} />
                </div>
            </div>

            {/* ── Layer 3: Tier Breakdown ────── */}
            {tierSegments.length > 0 && (
                <div style={sectionStyle}>
                    <div style={labelStyle}>Tier Breakdown</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 24, flexWrap: "wrap" }}>
                        <DonutChart
                            segments={tierSegments}
                            size={100}
                            centerLabel={String(totalVoted)}
                            centerSub="voters"
                        />
                        <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: 1, minWidth: 140 }}>
                            {voteRecords.filter(r => r.yesVoters.length + r.noVoters.length + r.abstainVoters.length > 0).map((r, i) => (
                                <div key={r.tier} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                    <span style={{
                                        width: 10, height: 10, borderRadius: "50%", flexShrink: 0,
                                        background: tierColor(r.tier, i),
                                        boxShadow: `0 0 6px ${tierColor(r.tier, i)}44`,
                                    }} />
                                    <div style={{ flex: 1 }}>
                                        <div style={{ fontSize: 12, fontWeight: 600, color: "#f0f0f0", fontFamily: "JetBrains Mono, monospace" }}>
                                            {r.tier}
                                        </div>
                                        <div style={{ fontSize: 10, fontFamily: "JetBrains Mono, monospace", display: "flex", gap: 8 }}>
                                            <span style={{ color: YES_COLOR }}>{r.yesVoters.length} yes</span>
                                            <span style={{ color: NO_COLOR }}>{r.noVoters.length} no</span>
                                            {r.abstainVoters.length > 0 && (
                                                <span style={{ color: ABSTAIN_COLOR }}>{r.abstainVoters.length} abstain</span>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}

// ── Compact Tier Dots (for ProposalCard) ─────────────────

export function TierDots({ voteRecords }: { voteRecords: VoteRecord[] }) {
    const active = voteRecords.filter(r => r.yesVoters.length + r.noVoters.length + r.abstainVoters.length > 0)
    if (active.length === 0) return null

    return (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {active.map((r, i) => {
                const total = r.yesVoters.length + r.noVoters.length + r.abstainVoters.length
                return (
                    <div key={r.tier} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <span style={{
                            width: 7, height: 7, borderRadius: "50%",
                            background: tierColor(r.tier, i),
                            boxShadow: `0 0 4px ${tierColor(r.tier, i)}44`,
                        }} />
                        <span style={{ fontSize: 9, fontFamily: "JetBrains Mono, monospace", color: "#666" }}>
                            {r.tier}: {total}
                        </span>
                    </div>
                )
            })}
        </div>
    )
}
