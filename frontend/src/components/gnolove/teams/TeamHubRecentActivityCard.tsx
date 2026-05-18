/**
 * TeamHubRecentActivityCard — team-scoped merged PRs in the selected period.
 *
 * Built on `useGnoloveYearReport` (already cached) so we don't issue another
 * backend round-trip. Filters client-side by the team's member list and the
 * period cutoff; shows the most recent N. Empty state explains the period
 * choice rather than blanking.
 *
 * @module components/gnolove/teams/TeamHubRecentActivityCard
 */

import { useMemo } from "react"
import { useGnoloveYearReport } from "../../../hooks/gnolove"
import type { TPullRequest } from "../../../lib/gnoloveSchemas"
import type { Team } from "../../../lib/gnoloveConstants"
import { periodToCutoff, TEAM_HUB_PERIOD_LABELS, type TeamHubPeriod } from "../../../lib/gnolovePeriod"

const MAX_ROWS = 10

interface Props {
    team: Team
    period: TeamHubPeriod
}

function prAuthorLogin(pr: TPullRequest): string {
    // Author can land as either the nested object or the flattened authorLogin
    // field depending on which endpoint the report came from. Use both.
    return pr.author?.login ?? pr.authorLogin ?? ""
}

function repoFromUrl(url: string): string {
    const m = url.match(/github\.com\/([^/]+\/[^/]+)/)
    return m ? m[1] : ""
}

function relTime(iso: string | null | undefined): string {
    if (!iso) return ""
    const ts = new Date(iso).getTime()
    if (Number.isNaN(ts)) return ""
    const diff = Date.now() - ts
    if (diff < 60_000) return "just now"
    const mins = Math.round(diff / 60_000)
    if (mins < 60) return `${mins}m ago`
    const hours = Math.round(mins / 60)
    if (hours < 24) return `${hours}h ago`
    const days = Math.round(hours / 24)
    if (days < 30) return `${days}d ago`
    const months = Math.round(days / 30)
    return `${months}mo ago`
}

export function TeamHubRecentActivityCard({ team, period }: Props) {
    const { data: report, isLoading } = useGnoloveYearReport()

    const rows = useMemo(() => {
        if (!report?.merged) return []
        const members = new Set(team.members.map(m => m.toLowerCase()))
        const cutoff = periodToCutoff(period)
        return report.merged
            .filter(pr => {
                const login = prAuthorLogin(pr).toLowerCase()
                if (!login || !members.has(login)) return false
                if (!cutoff) return true
                if (!pr.mergedAt) return false
                return new Date(pr.mergedAt).getTime() >= cutoff.getTime()
            })
            .sort((a, b) => {
                const ta = a.mergedAt ? new Date(a.mergedAt).getTime() : 0
                const tb = b.mergedAt ? new Date(b.mergedAt).getTime() : 0
                return tb - ta
            })
            .slice(0, MAX_ROWS)
    }, [report, team.members, period])

    if (isLoading && !report) {
        return (
            <div className="gl-thub-card">
                <h2 className="gl-thub-card-title">Recent merged PRs</h2>
                <div className="gl-thub-skel-stack">
                    <div className="gl-skeleton gl-skeleton-line" />
                    <div className="gl-skeleton gl-skeleton-line" />
                    <div className="gl-skeleton gl-skeleton-line" />
                </div>
            </div>
        )
    }

    return (
        <div className="gl-thub-card">
            <h2 className="gl-thub-card-title">Recent merged PRs</h2>
            {rows.length === 0 ? (
                <p className="gl-thub-empty">
                    No merged PRs from {team.name} in the “{TEAM_HUB_PERIOD_LABELS[period]}” window.
                </p>
            ) : (
                <ul className="gl-thub-activity-list">
                    {rows.map(pr => {
                        const login = prAuthorLogin(pr)
                        const repo = repoFromUrl(pr.url)
                        return (
                            <li key={pr.id} className="gl-thub-activity-row">
                                <a
                                    href={pr.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="gl-thub-activity-title"
                                >
                                    {pr.title}
                                </a>
                                <span className="gl-thub-activity-meta">
                                    <span className="gl-thub-activity-repo">{repo}</span>
                                    {login && <span className="gl-thub-activity-author">@{login}</span>}
                                    <span className="gl-thub-activity-when">{relTime(pr.mergedAt)}</span>
                                </span>
                            </li>
                        )
                    })}
                </ul>
            )}
        </div>
    )
}
