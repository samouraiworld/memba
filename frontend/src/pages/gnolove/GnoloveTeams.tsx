/**
 * GnoloveTeams — slim index of teams.
 *
 * Plan §2: "drop the duplicate; keep the index link grid." The page is
 * intentionally light — every numeric metric (PRs, commits, score) lives
 * on the team hub now, so this page is a navigation surface, not a
 * dashboard. The dense per-member breakdown that used to live here has
 * moved into the hub's metrics + recent-activity cards.
 *
 * Roster source is the seed-union (`useGnoloveTeams`) so the page tracks
 * the backend `config/teams.yaml` as soon as `/teams` responds.
 *
 * @module pages/gnolove/GnoloveTeams
 */

import { useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { useGnoloveTeams, useGnoloveContributors } from "../../hooks/gnolove"
import { useNetworkPath } from "../../hooks/useNetworkNav"
import { PageMeta } from "../../components/gnolove/PageMeta"
import { TEAM_CSS_COLORS, TimeFilter } from "../../lib/gnoloveConstants"
import { sortTeamsByScore } from "../../lib/gnoloveAnalytics"
import { formatRelativeTime } from "../../lib/gnoloveTime"

export default function GnoloveTeams() {
    const np = useNetworkPath()
    const { teams, lastSyncedAt } = useGnoloveTeams()
    // Order teams by their "This month" aggregate score (the default window).
    // While contributors load or on error, `sortTeamsByScore` returns the
    // curated roster order unchanged — the index never blanks or reshuffles.
    const { data: contributors } = useGnoloveContributors(TimeFilter.MONTHLY)
    const orderedTeams = useMemo(
        () => sortTeamsByScore(teams, contributors),
        [teams, contributors],
    )
    const [nowMs] = useState(() => Date.now())

    return (
        <div className="gl-page">
            <PageMeta title="Teams | Gnolove · Memba" description="Contributor teams in the Gno ecosystem." />
            <Link to={np("gnolove")} className="gl-profile-back">← Back to Contributors Overview</Link>
            <div className="gl-header">
                <h1 className="gl-title">Teams</h1>
                {lastSyncedAt && (
                    <span className="gl-thub-chip gl-thub-chip-sync" title={new Date(lastSyncedAt).toISOString()}>
                        Roster updated: {formatRelativeTime(lastSyncedAt, nowMs)}
                    </span>
                )}
            </div>

            <div className="gl-teams-list">
                {orderedTeams.map(team => (
                    <Link
                        key={team.slug}
                        to={np(`gnolove/teams/${encodeURIComponent(team.slug)}`)}
                        className="gl-teams-panel"
                        style={{ borderLeftColor: TEAM_CSS_COLORS[team.color], textDecoration: "none" }}
                    >
                        <div className="gl-teams-panel-header">
                            <div className="gl-teams-panel-title">
                                {team.logoUrl && (
                                    <img
                                        src={`${team.logoUrl}?s=40`}
                                        alt=""
                                        className="gl-teams-panel-logo"
                                        loading="lazy"
                                        width={20}
                                        height={20}
                                    />
                                )}
                                <span
                                    style={{ color: TEAM_CSS_COLORS[team.color], fontSize: 16, fontWeight: 600 }}
                                >
                                    {team.name}
                                </span>
                            </div>
                            <span className="gl-teams-panel-stats">
                                {team.members.length} {team.members.length === 1 ? "member" : "members"}
                            </span>
                        </div>
                        {team.description && (
                            <p className="gl-team-profile-desc" style={{ margin: "8px 0 0" }}>
                                {team.description}
                            </p>
                        )}
                        {(team.website || team.twitter) && (
                            <div className="gl-teams-panel-socials">
                                {team.website && (
                                    <span className="gl-teams-panel-social" title={team.website}>
                                        {team.website.replace(/^https?:\/\//, "")}
                                    </span>
                                )}
                                {team.twitter && (
                                    <span className="gl-teams-panel-social" title={`@${team.twitter}`}>
                                        @{team.twitter}
                                    </span>
                                )}
                            </div>
                        )}
                    </Link>
                ))}
            </div>
        </div>
    )
}
