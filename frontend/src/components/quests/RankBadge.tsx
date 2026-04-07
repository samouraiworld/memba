/**
 * RankBadge — Visual rank indicator displayed next to usernames,
 * on profiles, in the sidebar, and on the leaderboard.
 */

interface RankBadgeProps {
    tier: number
    name: string
    color: string
    size?: "sm" | "md" | "lg"
}

const TIER_ICONS = ["", "🥉", "🥈", "🥇", "💎", "💠", "🖤", "🛡️"]

export function RankBadge({ tier, name, color, size = "md" }: RankBadgeProps) {
    if (tier === 0) return null // Don't show badge for Newcomer

    const icon = TIER_ICONS[tier] || ""

    return (
        <span
            className={`k-rank-badge k-rank-badge--${size}`}
            style={{ background: `linear-gradient(135deg, ${color}, ${color}88)` }}
            title={name}
            data-testid="rank-badge"
        >
            <span className="k-rank-badge-icon">{icon}</span>
            {size !== "sm" && <span className="k-rank-badge-name">{name}</span>}
        </span>
    )
}
