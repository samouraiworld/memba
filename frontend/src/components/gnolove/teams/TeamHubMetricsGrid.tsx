/**
 * TeamHubMetricsGrid — five-stat strip powered by /team-stats totals.
 *
 * Numbers come straight from the backend's precomputed roll-up so the
 * card renders without any client-side aggregation. Loading state shows
 * skeleton blocks; failure renders zeroes with a subdued note rather
 * than disappearing entirely (consistent with the rest of the hub).
 *
 * @module components/gnolove/teams/TeamHubMetricsGrid
 */

import type { TTeamStatsResponse } from "../../../lib/gnoloveSchemas"

interface Props {
    stats: TTeamStatsResponse | null | undefined
    isLoading: boolean
    teamMemberCount: number
}

function MetricCell({ label, value }: { label: string; value: number | string }) {
    return (
        <div className="gl-thub-metric">
            <span className="gl-thub-metric-value">{value}</span>
            <span className="gl-thub-metric-label">{label}</span>
        </div>
    )
}

export function TeamHubMetricsGrid({ stats, isLoading, teamMemberCount }: Props) {
    if (isLoading && !stats) {
        return (
            <div className="gl-thub-card">
                <div className="gl-thub-metrics-grid">
                    {Array.from({ length: 5 }).map((_, i) => (
                        <div key={i} className="gl-thub-metric gl-thub-metric-skel">
                            <span className="gl-skeleton gl-skeleton-line" />
                            <span className="gl-skeleton gl-skeleton-line gl-skeleton-line-sm" />
                        </div>
                    ))}
                </div>
            </div>
        )
    }

    const merged = stats?.totals.mergedPRs ?? 0
    const activeContributors = stats?.totals.activeContributors ?? 0
    const activeRepos = stats?.totals.activeRepos ?? 0

    return (
        <div className="gl-thub-card">
            <div
                className="gl-thub-metrics-grid"
                aria-live="polite"
                aria-label="Team metrics"
            >
                <MetricCell label="Roster" value={teamMemberCount} />
                <MetricCell label="Active contributors" value={activeContributors} />
                <MetricCell label="Active repos" value={activeRepos} />
                <MetricCell label="Merged PRs" value={merged} />
                <MetricCell
                    label="PRs per contributor"
                    value={activeContributors > 0 ? (merged / activeContributors).toFixed(1) : "—"}
                />
            </div>
        </div>
    )
}
