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

import { useState } from "react"
import { Link } from "react-router-dom"
import { useGnoloveTeams } from "../../hooks/gnolove"
import { useNetworkPath } from "../../hooks/useNetworkNav"
import { PageMeta } from "../../components/gnolove/PageMeta"
import { TEAM_CSS_COLORS } from "../../lib/gnoloveConstants"
import { formatRelativeTime } from "../../lib/gnoloveTime"

export default function GnoloveTeams() {
    const np = useNetworkPath()
    const { teams, lastSyncedAt } = useGnoloveTeams()
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
                {teams.map(team => (
                    <Link
                        key={team.slug}
                        to={np(`gnolove/teams/${encodeURIComponent(team.slug)}`)}
                        className="gl-teams-panel"
                        style={{ borderLeftColor: TEAM_CSS_COLORS[team.color], textDecoration: "none" }}
                    >
                        <div className="gl-teams-panel-header">
                            <div className="gl-teams-panel-title">
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
                    </Link>
                ))}
            </div>
        </div>
    )
}
