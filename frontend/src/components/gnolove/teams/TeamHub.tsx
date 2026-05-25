/**
 * TeamHub — orchestrator for the team page.
 *
 * Wires up the team lookup, URL-state period, per-card queries, the
 * backend health probe, and the degradation banner. Each card sits
 * behind a {@link CardErrorBoundary} so a crash in one card doesn't
 * black-out the page.
 *
 * @module components/gnolove/teams/TeamHub
 */

import { Link, useParams } from "react-router-dom"
import { useGnoloveTeams, useGnoloveTeamActiveRepos, useGnoloveTeamStats, useTeamProfileUrlState, useGnoloveBackendHealth } from "../../../hooks/gnolove"
import { useNetwork } from "../../../hooks/useNetwork"
import { useNetworkPath } from "../../../hooks/useNetworkNav"
import { PageMeta } from "../PageMeta"
import { GnoloveErrorBoundary } from "../GnoloveErrorBoundary"
import { HubBackendDownBanner } from "./HubBackendDownBanner"
import { TeamHubHeader } from "./TeamHubHeader"
import { TeamHubMetricsGrid } from "./TeamHubMetricsGrid"
import { TeamHubActiveReposCard } from "./TeamHubActiveReposCard"
import { TeamHubRecentActivityCard } from "./TeamHubRecentActivityCard"
import { TeamHubAIReportsCard } from "./TeamHubAIReportsCard"
import { TeamHubFocusAreasCard } from "./TeamHubFocusAreasCard"
import { TeamHubReportCard } from "./TeamHubReportCard"
import { periodToBackendParam } from "../../../lib/gnolovePeriod"
import type { Team } from "../../../lib/gnoloveConstants"

function findTeam(teams: Team[], rawParam: string): Team | null {
    const decoded = decodeURIComponent(rawParam)
    const lower = decoded.toLowerCase()
    return (
        teams.find(t => t.slug.toLowerCase() === lower) ??
        teams.find(t => t.name.toLowerCase() === lower) ??
        null
    )
}

export function TeamHub() {
    const np = useNetworkPath()
    const { networkKey } = useNetwork()
    const { teamName } = useParams<{ teamName: string }>()
    const { teams, lastSyncedAt } = useGnoloveTeams()
    const { period, repos, setPeriod } = useTeamProfileUrlState()
    const health = useGnoloveBackendHealth()

    const team = teamName ? findTeam(teams, teamName) : null
    const backHref = np("gnolove/teams")

    const activeReposQuery = useGnoloveTeamActiveRepos(team?.slug, periodToBackendParam(period))
    const teamStatsQuery = useGnoloveTeamStats(team?.slug, periodToBackendParam(period), repos)

    const cardErrorCount =
        (activeReposQuery.isError ? 1 : 0) +
        (teamStatsQuery.isError ? 1 : 0)

    const oldestDataUpdate = [activeReposQuery.dataUpdatedAt, teamStatsQuery.dataUpdatedAt]
        .filter((t): t is number => t != null && t > 0)
        .sort()[0]

    if (!team) {
        const decoded = teamName ? decodeURIComponent(teamName) : ""
        return (
            <div className="gl-page">
                <PageMeta title="Team not found | Gnolove · Memba" description="The requested team could not be found." noindex />
                <Link to={backHref} className="gl-profile-back">&larr; Back to Teams</Link>
                <div className="gl-empty">
                    <p>Team not found: {decoded}</p>
                    <Link to={backHref} className="gl-filter-btn gl-filter-btn--active" style={{ marginTop: 12, display: "inline-block" }}>See all teams &rarr;</Link>
                </div>
            </div>
        )
    }

    return (
        <div className="gl-page gl-thub-page">
            <PageMeta
                title={`${team.name} | Gnolove · Memba`}
                description={team.description ?? `Team profile for ${team.name}.`}
            />

            <HubBackendDownBanner
                health={health}
                cardErrorCount={cardErrorCount}
                dataUpdatedAt={oldestDataUpdate}
            />

            <GnoloveErrorBoundary name="Header" variant="card">
                <TeamHubHeader
                    team={team}
                    period={period}
                    onPeriodChange={setPeriod}
                    lastSyncedAt={lastSyncedAt}
                    networkKey={networkKey}
                    backToTeamsHref={backHref}
                />
            </GnoloveErrorBoundary>

            <GnoloveErrorBoundary name="Metrics" variant="card" onRetry={() => teamStatsQuery.refetch()}>
                <TeamHubMetricsGrid
                    stats={teamStatsQuery.data}
                    isLoading={teamStatsQuery.isLoading}
                    isError={teamStatsQuery.isError}
                    onRetry={() => teamStatsQuery.refetch()}
                    teamMemberCount={team.members.length}
                />
            </GnoloveErrorBoundary>

            <GnoloveErrorBoundary name="Team report" variant="card">
                <TeamHubReportCard team={team} period={period} />
            </GnoloveErrorBoundary>

            <GnoloveErrorBoundary name="Active repositories" variant="card" onRetry={() => activeReposQuery.refetch()}>
                <TeamHubActiveReposCard
                    data={activeReposQuery.data}
                    isLoading={activeReposQuery.isLoading}
                    isError={activeReposQuery.isError}
                    onRetry={() => activeReposQuery.refetch()}
                />
            </GnoloveErrorBoundary>

            <GnoloveErrorBoundary name="Focus areas" variant="card">
                <TeamHubFocusAreasCard team={team} period={period} />
            </GnoloveErrorBoundary>

            <GnoloveErrorBoundary name="Recent activity" variant="card">
                <TeamHubRecentActivityCard team={team} period={period} />
            </GnoloveErrorBoundary>

            <GnoloveErrorBoundary name="AI weekly report" variant="card">
                <TeamHubAIReportsCard team={team} />
            </GnoloveErrorBoundary>
        </div>
    )
}
