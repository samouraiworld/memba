/**
 * TierPieChart — SVG donut chart showing vote distribution by tier.
 *
 * Each tier gets a distinct color segment. Tooltip on hover shows breakdown.
 * Used in ProposalCard (overview) and ProposalView (detail).
 *
 * v2.0: Increased default size to 48, added optional inline legend (Step 4).
 */

export interface TierVote {
    tier: string
    yesVotes: number
    noVotes: number
}

interface Props {
    tiers: TierVote[]
    /** Chart diameter in px. Default: 48 (was 32 in v1.x). */
    size?: number
    /** Show inline legend below chart. Default: false for card mode, true for detail. */
    showLegend?: boolean
}

const TIER_COLORS = ["#00d4aa", "#7b61ff", "#f5a623", "#3b82f6", "#ef4444", "#8b5cf6"]

export function TierPieChart({ tiers, size = 48, showLegend = false }: Props) {
    const totalVotes = tiers.reduce((sum, t) => sum + t.yesVotes + t.noVotes, 0)
    if (totalVotes === 0) return null

    const radius = size / 2 - 2
    const cx = size / 2
    const cy = size / 2
    const strokeWidth = size * 0.22

    // Precompute segments with angles
    const segmentData: { tier: string; startAngle: number; angleDeg: number; colorIdx: number; yesVotes: number; noVotes: number }[] = []
    let angle = -90
    tiers.forEach((t, i) => {
        const votes = t.yesVotes + t.noVotes
        if (votes === 0) return
        const angleDeg = (votes / totalVotes) * 360
        segmentData.push({ tier: t.tier, startAngle: angle, angleDeg, colorIdx: i, yesVotes: t.yesVotes, noVotes: t.noVotes })
        angle += angleDeg
    })

    return (
        <div style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
            <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flexShrink: 0 }}>
                {/* Background ring */}
                <circle cx={cx} cy={cy} r={radius} fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth={strokeWidth} />
                {segmentData.map(seg => {
                    const startRad = (seg.startAngle * Math.PI) / 180
                    const endRad = ((seg.startAngle + seg.angleDeg) * Math.PI) / 180
                    const x1 = cx + radius * Math.cos(startRad)
                    const y1 = cy + radius * Math.sin(startRad)
                    const x2 = cx + radius * Math.cos(endRad)
                    const y2 = cy + radius * Math.sin(endRad)
                    const largeArc = seg.angleDeg > 180 ? 1 : 0
                    return (
                        <path
                            key={seg.tier}
                            d={`M ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2}`}
                            fill="none"
                            stroke={TIER_COLORS[seg.colorIdx % TIER_COLORS.length]}
                            strokeWidth={strokeWidth}
                            strokeLinecap="round"
                        >
                            <title>{`${seg.tier}: ${seg.yesVotes} YES, ${seg.noVotes} NO`}</title>
                        </path>
                    )
                })}
                {/* Center label: total votes */}
                <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central"
                    fill="#888" fontSize={size * 0.22} fontFamily="JetBrains Mono, monospace">
                    {totalVotes}
                </text>
            </svg>

            {/* Inline legend */}
            {showLegend && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 10px", justifyContent: "center" }}>
                    {segmentData.map(seg => (
                        <div key={seg.tier} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                            <span style={{
                                width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
                                background: TIER_COLORS[seg.colorIdx % TIER_COLORS.length],
                            }} />
                            <span style={{
                                fontSize: 9, fontFamily: "JetBrains Mono, monospace",
                                color: "#888", whiteSpace: "nowrap",
                            }}>
                                {seg.tier}
                            </span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}
