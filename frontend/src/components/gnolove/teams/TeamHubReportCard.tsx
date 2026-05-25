import { useMemo } from "react"
import { Link } from "react-router-dom"
import { useGnoloveYearReport } from "../../../hooks/gnolove"
import { useNetworkPath } from "../../../hooks/useNetworkNav"
import { extractRepoFromUrl } from "../../../lib/gnoloveApi"
import type { TPullRequest } from "../../../lib/gnoloveSchemas"
import type { Team } from "../../../lib/gnoloveConstants"
import { periodToCutoff, type TeamHubPeriod } from "../../../lib/gnolovePeriod"
import { RepoBadge } from "../RepoBadge"

interface Props {
    team: Team
    period: TeamHubPeriod
}

function prAuthorLogin(pr: TPullRequest): string {
    return pr.author?.login ?? pr.authorLogin ?? ""
}

interface StatusCounts {
    merged: number
    inProgress: number
    waitingForReview: number
    blocked: number
}

function formatShortDate(iso: string): string {
    try {
        return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" })
    } catch {
        return iso.slice(0, 10)
    }
}

export function TeamHubReportCard({ team, period }: Props) {
    const np = useNetworkPath()
    const { data: report, isLoading } = useGnoloveYearReport()

    const { counts, recentMerged } = useMemo(() => {
        if (!report) return { counts: null, recentMerged: [] }
        const members = new Set(team.members.map(m => m.toLowerCase()))
        const cutoff = periodToCutoff(period)

        const isInPeriod = (pr: TPullRequest, dateField: "mergedAt" | "createdAt") => {
            if (!cutoff) return true
            const d = pr[dateField]
            if (!d) return false
            return new Date(d).getTime() >= cutoff.getTime()
        }

        const isTeamPR = (pr: TPullRequest) => {
            const login = prAuthorLogin(pr).toLowerCase()
            return login !== "" && members.has(login)
        }

        const merged = (report.merged ?? []).filter(pr => isTeamPR(pr) && isInPeriod(pr, "mergedAt"))
        const inProgress = (report.in_progress ?? []).filter(pr => isTeamPR(pr) && isInPeriod(pr, "createdAt"))
        const waitingForReview = (report.waiting_for_review ?? []).filter(pr => isTeamPR(pr) && isInPeriod(pr, "createdAt"))
        const blocked = (report.blocked ?? []).filter(pr => isTeamPR(pr) && isInPeriod(pr, "createdAt"))

        const statusCounts: StatusCounts = {
            merged: merged.length,
            inProgress: inProgress.length,
            waitingForReview: waitingForReview.length,
            blocked: blocked.length,
        }

        const recent = merged
            .slice()
            .sort((a, b) => new Date(b.mergedAt!).getTime() - new Date(a.mergedAt!).getTime())
            .slice(0, 3)

        return { counts: statusCounts, recentMerged: recent }
    }, [report, team.members, period])

    if (isLoading && !report) {
        return (
            <div className="gl-thub-card" aria-busy="true">
                <h2 className="gl-thub-card-title">Team report</h2>
                <div className="gl-thub-report-skel">
                    {Array.from({ length: 3 }).map((_, i) => (
                        <span key={i} className="gl-skeleton gl-thub-skel-pill" />
                    ))}
                </div>
            </div>
        )
    }

    if (!counts) return null

    const total = counts.merged + counts.inProgress + counts.waitingForReview + counts.blocked
    const reportUrl = np(`gnolove/report?team=${encodeURIComponent(team.name)}`)

    return (
        <div className="gl-thub-card">
            <h2 className="gl-thub-card-title">Team report</h2>

            {total === 0 ? (
                <p className="gl-thub-empty">No PR activity for this team in the selected period.</p>
            ) : (
                <>
                    <div className="gl-thub-report-counts">
                        <span className="gl-thub-report-stat gl-thub-report-stat--merged">
                            <span className="gl-thub-report-stat-num">{counts.merged}</span> merged
                        </span>
                        <span className="gl-thub-report-stat gl-thub-report-stat--progress">
                            <span className="gl-thub-report-stat-num">{counts.inProgress}</span> in progress
                        </span>
                        <span className="gl-thub-report-stat gl-thub-report-stat--review">
                            <span className="gl-thub-report-stat-num">{counts.waitingForReview}</span> in review
                        </span>
                        {counts.blocked > 0 && (
                            <span className="gl-thub-report-stat gl-thub-report-stat--blocked">
                                <span className="gl-thub-report-stat-num">{counts.blocked}</span> blocked
                            </span>
                        )}
                    </div>

                    {recentMerged.length > 0 && (
                        <ul className="gl-thub-report-recent">
                            {recentMerged.map(pr => {
                                const repo = extractRepoFromUrl(pr.url)
                                return (
                                    <li key={pr.url} className="gl-thub-report-recent-item">
                                        <a href={pr.url} target="_blank" rel="noopener noreferrer" className="gl-thub-report-recent-link">
                                            <span className="gl-thub-report-recent-title">{pr.title}</span>
                                            <span className="gl-thub-report-recent-meta">
                                                {repo && <><RepoBadge repo={repo} />{" "}</>}
                                                <span className="gl-thub-report-recent-date">{formatShortDate(pr.mergedAt!)}</span>
                                            </span>
                                        </a>
                                    </li>
                                )
                            })}
                        </ul>
                    )}
                </>
            )}

            <Link to={reportUrl} className="gl-thub-report-link">
                View full report &rarr;
            </Link>
        </div>
    )
}
