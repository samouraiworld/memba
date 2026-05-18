/**
 * TeamHubFocusAreasCard — top-5 expertise pills for the team.
 *
 * Operator decision Q-5: pills v1, not a matrix and not a force graph.
 * Built from merged-PR signals (repo name + title) matched against a
 * local taxonomy. Phase 2c will migrate the regex bag to the server
 * (gnolove/server/config/topics.yaml) so the client doesn't drift.
 *
 * @module components/gnolove/teams/TeamHubFocusAreasCard
 */

import { useMemo } from "react"
import { useGnoloveYearReport } from "../../../hooks/gnolove"
import type { TPullRequest } from "../../../lib/gnoloveSchemas"
import type { Team } from "../../../lib/gnoloveConstants"
import { periodToCutoff, type TeamHubPeriod } from "../../../lib/gnolovePeriod"
import { computeFocusAreas, FOCUS_TOPIC_LABELS } from "../../../lib/gnoloveFocusAreas"

interface Props {
    team: Team
    period: TeamHubPeriod
}

function prAuthorLogin(pr: TPullRequest): string {
    return pr.author?.login ?? pr.authorLogin ?? ""
}

function repoFromUrl(url: string): string {
    const m = url.match(/github\.com\/([^/]+\/[^/]+)/)
    return m ? m[1] : ""
}

export function TeamHubFocusAreasCard({ team, period }: Props) {
    const { data: report, isLoading } = useGnoloveYearReport()

    const pills = useMemo(() => {
        if (!report?.merged) return []
        const members = new Set(team.members.map(m => m.toLowerCase()))
        const cutoff = periodToCutoff(period)
        const signals = report.merged
            .filter(pr => {
                const login = prAuthorLogin(pr).toLowerCase()
                if (!login || !members.has(login)) return false
                if (!cutoff) return true
                if (!pr.mergedAt) return false
                return new Date(pr.mergedAt).getTime() >= cutoff.getTime()
            })
            .map(pr => ({ repo: repoFromUrl(pr.url), title: pr.title }))
        return computeFocusAreas(signals)
    }, [report, team.members, period])

    if (isLoading && !report) {
        return (
            <div className="gl-thub-card">
                <h2 className="gl-thub-card-title">Focus areas</h2>
                <div className="gl-thub-skel-stack">
                    <div className="gl-skeleton gl-skeleton-line" />
                </div>
            </div>
        )
    }

    return (
        <div className="gl-thub-card">
            <h2 className="gl-thub-card-title">Focus areas</h2>
            <p className="gl-thub-card-hint">
                Honest v1: top-5 topics derived from merged PRs in this period.
                Matrix view (per-repo × per-topic) is a follow-up.
            </p>
            {pills.length === 0 ? (
                <p className="gl-thub-empty">Not enough merged-PR signal to derive topics for this period.</p>
            ) : (
                <ul className="gl-thub-pills">
                    {pills.map(p => (
                        <li key={p.topic} className="gl-thub-pill">
                            <span className="gl-thub-pill-label">{FOCUS_TOPIC_LABELS[p.topic]}</span>
                            <span className="gl-thub-pill-count">{p.count}</span>
                            <span className="gl-thub-pill-share">{Math.round(p.share * 100)}%</span>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    )
}
