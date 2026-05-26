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

import { useState, useRef, useEffect } from "react"
import type { TTeamStatsResponse } from "../../../lib/gnoloveSchemas"

interface Props {
    stats: TTeamStatsResponse | null | undefined
    isLoading: boolean
    isError: boolean
    onRetry: () => void
    teamMemberCount: number
    teamMembers: string[]
}

function MetricCell({ label, value }: { label: string; value: number | string }) {
    return (
        <div className="gl-thub-metric">
            <span className="gl-thub-metric-value">{value}</span>
            <span className="gl-thub-metric-label">{label}</span>
        </div>
    )
}

function RosterCell({ count, members }: { count: number; members: string[] }) {
    const [open, setOpen] = useState(false)
    const ref = useRef<HTMLDivElement>(null)

    useEffect(() => {
        if (!open) return
        function handleClick(e: MouseEvent) {
            if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
        }
        document.addEventListener("mousedown", handleClick)
        return () => document.removeEventListener("mousedown", handleClick)
    }, [open])

    return (
        <div className="gl-thub-metric gl-thub-metric--roster" ref={ref}>
            <button
                className="gl-thub-roster-toggle"
                onClick={() => setOpen(v => !v)}
                aria-expanded={open}
                aria-label={`Roster: ${count} members. Click to see list.`}
            >
                <span className="gl-thub-metric-value">{count}</span>
                <span className="gl-thub-metric-label">Roster ▾</span>
            </button>
            {open && members.length > 0 && (
                <div className="gl-thub-roster-popover" role="tooltip">
                    <p className="gl-thub-roster-heading">{count} members</p>
                    <ul className="gl-thub-roster-list">
                        {members.map(m => (
                            <li key={m}>
                                <a href={`https://github.com/${m}`} target="_blank" rel="noopener noreferrer">{m}</a>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    )
}

export function TeamHubMetricsGrid({ stats, isLoading, isError, onRetry, teamMemberCount, teamMembers }: Props) {
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

    const hasFailed = isError || (!isLoading && stats == null)

    const merged = stats?.totals.mergedPRs ?? 0
    const activeContributors = stats?.totals.activeContributors ?? 0
    const activeRepos = stats?.totals.activeRepos ?? 0

    return (
        <div className="gl-thub-card">
            <span className="gl-sr-only" aria-live="polite">
                {hasFailed ? "Metrics unavailable" : `${merged} merged PRs, ${activeContributors} active contributors`}
            </span>
            <div
                className="gl-thub-metrics-grid"
                aria-label="Team metrics"
            >
                <RosterCell count={teamMemberCount} members={teamMembers} />
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
                    {" "}<button className="gl-thub-inline-retry" onClick={onRetry}>Retry</button>
                </p>
            )}
        </div>
    )
}
