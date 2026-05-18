/**
 * TeamHub — orchestrator for the Phase 4 team page.
 *
 * Wires up the team lookup, the URL-state period, and the per-card queries
 * (active-repos, team-stats). Each card sits behind a {@link CardErrorBoundary}
 * so a shape mismatch on one endpoint doesn't black-out the page.
 *
 * The "not found" path is intentionally minimal: if the team doesn't exist
 * in either the seed roster or the live one, we render a polite message and
 * keep the back link visible. Phase 5 will extend this with the AI report
 * card body.
 *
 * @module components/gnolove/teams/TeamHub
 */

import { Link, useParams } from "react-router-dom"
import { useGnoloveTeams, useGnoloveTeamActiveRepos, useGnoloveTeamStats, useTeamProfileUrlState } from "../../../hooks/gnolove"
import { useNetwork } from "../../../hooks/useNetwork"
import { useNetworkPath } from "../../../hooks/useNetworkNav"
import { PageMeta } from "../PageMeta"
import { CardErrorBoundary } from "./CardErrorBoundary"
import { TeamHubHeader } from "./TeamHubHeader"
import { TeamHubMetricsGrid } from "./TeamHubMetricsGrid"
import { TeamHubActiveReposCard } from "./TeamHubActiveReposCard"
import { periodToBackendParam } from "../../../lib/gnolovePeriod"
import type { Team } from "../../../lib/gnoloveConstants"

function findTeam(teams: Team[], rawParam: string): Team | null {
    const decoded = decodeURIComponent(rawParam)
    const lower = decoded.toLowerCase()
    // Slug lookup first (new URL form), then name match (legacy URLs).
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

    const team = teamName ? findTeam(teams, teamName) : null
    const backHref = np("gnolove/teams")

    const activeReposQuery = useGnoloveTeamActiveRepos(team?.slug, periodToBackendParam(period))
    const teamStatsQuery = useGnoloveTeamStats(team?.slug, periodToBackendParam(period), repos)

    if (!team) {
        const decoded = teamName ? decodeURIComponent(teamName) : ""
        return (
            <div className="gl-page">
                <PageMeta title="Team not found | Gnolove · Memba" description="The requested team could not be found." />
                <Link to={backHref} className="gl-profile-back">&larr; Back to Teams</Link>
                <div className="gl-empty">Team not found: {decoded}</div>
            </div>
        )
    }

    return (
        <div className="gl-page gl-thub-page">
            <PageMeta
                title={`${team.name} | Gnolove · Memba`}
                description={team.description ?? `Team profile for ${team.name}.`}
            />

            <CardErrorBoundary name="Header">
                <TeamHubHeader
                    team={team}
                    period={period}
                    onPeriodChange={setPeriod}
                    lastSyncedAt={lastSyncedAt}
                    networkKey={networkKey}
                    backToTeamsHref={backHref}
                />
            </CardErrorBoundary>

            <CardErrorBoundary name="Metrics">
                <TeamHubMetricsGrid
                    stats={teamStatsQuery.data}
                    isLoading={teamStatsQuery.isLoading}
                    teamMemberCount={team.members.length}
                />
            </CardErrorBoundary>

            <CardErrorBoundary name="Active repositories">
                <TeamHubActiveReposCard
                    data={activeReposQuery.data}
                    isLoading={activeReposQuery.isLoading}
                />
            </CardErrorBoundary>

            {/* Phase 4 Commits 3-4 fill the remaining three cards:
                  - TeamHubRecentActivityCard
                  - TeamHubFocusAreasCard
                  - TeamHubAIReportsCard
                The page already renders the foundation cards as soon as the
                backend responds, so the hub is useful before those land. */}
        </div>
    )
}
