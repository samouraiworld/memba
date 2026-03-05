/**
 * TierPieChart — Compact SVG donut chart showing vote distribution by tier.
 *
 * Each tier gets a distinct color segment. Tooltip on hover shows breakdown.
 * Used in ProposalCard (overview) and ProposalView (detail).
 */

interface TierVote {
    tier: string
    yesVotes: number
    noVotes: number
}

interface Props {
    tiers: TierVote[]
    size?: number
}

const TIER_COLORS = ["#00d4aa", "#7b61ff", "#f5a623", "#3b82f6", "#ef4444", "#8b5cf6"]

export function TierPieChart({ tiers, size = 32 }: Props) {
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
        </svg>
    )
}
