/**
 * TeamHubMetricsGrid — five-stat strip powered by /team-stats totals.
 *
 * Numbers come straight from the backend's precomputed roll-up so the
 * card renders without any client-side aggregation. Three states:
 *   - Loading (no prior data): shaped skeleton.
 *   - Error (`stats == null` after the fetch resolved): every backend-fed
 *     cell renders "—" and the card sets aria-busy=false + a subdued
 *     error note. The Roster cell is still populated from the local
 *     `teamMemberCount` prop since that's a client-side value.
 *   - Success: render the totals.
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
            <div className="gl-thub-card" aria-busy="true">
                <div className="gl-thub-metrics-grid" aria-hidden="true">
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

    // After loading resolves: stats may be null when the fetch failed (gnoloveApi
    // returns null on error). Render an honest "—" state instead of silently
    // showing zeros, which would read as "this team did nothing this period."
    const hasFailed = !isLoading && stats == null

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
                <MetricCell label="Active contributors" value={hasFailed ? "—" : activeContributors} />
                <MetricCell label="Active repos" value={hasFailed ? "—" : activeRepos} />
                <MetricCell label="Merged PRs" value={hasFailed ? "—" : merged} />
                <MetricCell
                    label="PRs per contributor"
                    value={hasFailed
                        ? "—"
                        : activeContributors > 0
                            ? (merged / activeContributors).toFixed(1)
                            : "—"}
                />
            </div>
            {hasFailed && (
                <p className="gl-thub-empty" role="status">
                    Metrics unavailable. The backend didn't return data for this period.
                </p>
            )}
        </div>
    )
}
