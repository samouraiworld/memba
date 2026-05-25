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

import { useMemo, useState } from "react"
import { useGnoloveYearReport } from "../../../hooks/gnolove"
import { extractRepoFromUrl } from "../../../lib/gnoloveApi"
import type { TPullRequest } from "../../../lib/gnoloveSchemas"
import type { Team } from "../../../lib/gnoloveConstants"
import { periodToCutoff, TEAM_HUB_PERIOD_LABELS, type TeamHubPeriod } from "../../../lib/gnolovePeriod"

const MAX_ROWS = 10

interface Props {
    team: Team
    period: TeamHubPeriod
}

function prAuthorLogin(pr: TPullRequest): string {
    return pr.author?.login ?? pr.authorLogin ?? ""
}

function relTime(iso: string | null | undefined, nowMs: number): string {
    if (!iso) return ""
    const ts = new Date(iso).getTime()
    if (Number.isNaN(ts)) return ""
    const diff = nowMs - ts
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
    const [nowMs] = useState(() => Date.now())
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
            <div className="gl-thub-card" aria-busy="true">
                <h2 className="gl-thub-card-title">Recent merged PRs</h2>
                <ul className="gl-thub-activity-list gl-thub-activity-list-skel" aria-hidden="true">
                    {Array.from({ length: 5 }).map((_, i) => (
                        <li key={i} className="gl-thub-activity-row-skel">
                            <span className="gl-skeleton gl-thub-skel-activity-title" />
                            <span className="gl-skeleton gl-thub-skel-activity-meta" />
                        </li>
                    ))}
                </ul>
            </div>
        )
    }

    return (
        <div className="gl-thub-card">
            <h2 className="gl-thub-card-title">Recent merged PRs</h2>
            <span className="gl-sr-only" aria-live="polite">
                {rows.length === 0 ? `No merged PRs in ${TEAM_HUB_PERIOD_LABELS[period]}` : `${rows.length} merged PRs`}
            </span>
            <div aria-label="Recent merged pull requests for the selected period">
            {rows.length === 0 ? (
                <p className="gl-thub-empty">
                    No merged PRs from {team.name} in the “{TEAM_HUB_PERIOD_LABELS[period]}” window.
                </p>
            ) : (
                <ul className="gl-thub-activity-list">
                    {rows.map(pr => {
                        const login = prAuthorLogin(pr)
                        const repo = extractRepoFromUrl(pr.url)
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
                                    <span className="gl-thub-activity-when">{relTime(pr.mergedAt, nowMs)}</span>
                                </span>
                            </li>
                        )
                    })}
                </ul>
            )}
            </div>
        </div>
    )
}
