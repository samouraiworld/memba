/**
 * TeamHubFocusAreasCard — top-5 expertise pills for the team.
 *
 * Operator decision Q-5: pills v1, not a matrix and not a force graph.
 * Built from merged-PR signals (repo name + title) matched against the
 * taxonomy. Phase 2c migrated the rule bag to the gnolove backend
 * (`config/topics.yaml`); this card now consumes the seed-union via
 * {@link useGnoloveTopics}, falling back to the build-time copy when
 * the backend hasn't responded.
 *
 * @module components/gnolove/teams/TeamHubFocusAreasCard
 */

import { useMemo } from "react"
import { useGnoloveYearReport, useGnoloveTopics } from "../../../hooks/gnolove"
import { extractRepoFromUrl } from "../../../lib/gnoloveApi"
import type { TPullRequest } from "../../../lib/gnoloveSchemas"
import type { Team } from "../../../lib/gnoloveConstants"
import { periodToCutoff, type TeamHubPeriod } from "../../../lib/gnolovePeriod"
import { computeFocusAreas } from "../../../lib/gnoloveFocusAreas"

interface Props {
    team: Team
    period: TeamHubPeriod
}

function prAuthorLogin(pr: TPullRequest): string {
    return pr.author?.login ?? pr.authorLogin ?? ""
}

export function TeamHubFocusAreasCard({ team, period }: Props) {
    const { data: report, isLoading } = useGnoloveYearReport()
    const { rules, labels } = useGnoloveTopics()

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
            .map(pr => ({ repo: extractRepoFromUrl(pr.url), title: pr.title }))
        return computeFocusAreas(signals, rules)
    }, [report, team.members, period, rules])

    if (isLoading && !report) {
        return (
            <div className="gl-thub-card" aria-busy="true">
                <h2 className="gl-thub-card-title">Focus areas</h2>
                <ul className="gl-thub-pills gl-thub-pills-skel" aria-hidden="true">
                    {Array.from({ length: 5 }).map((_, i) => (
                        <li key={i} className="gl-skeleton gl-thub-skel-pill" />
                    ))}
                </ul>
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
            <span className="gl-sr-only" aria-live="polite">
                {pills.length === 0 ? "No focus areas for this period" : `${pills.length} focus areas`}
            </span>
            <div aria-label="Focus areas for the selected period">
                {pills.length === 0 ? (
                    <p className="gl-thub-empty">Not enough merged-PR signal to derive topics for this period.</p>
                ) : (
                    <ul className="gl-thub-pills">
                        {pills.map(p => (
                            <li key={p.topic} className="gl-thub-pill">
                                <span className="gl-thub-pill-label">{labels[p.topic] ?? p.topic}</span>
                                <span className="gl-thub-pill-count">{p.count}</span>
                                <span className="gl-thub-pill-share">{Math.round(p.share * 100)}%</span>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </div>
    )
}
