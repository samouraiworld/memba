/**
 * TeamHubHeader — colour-stripe header + period selector + sync pill + network chip.
 *
 * The chips serve two trust-signals:
 *   - "Roster updated: <relative>" tells the user when the team config was
 *     last deployed. It comes from `useGnoloveTeams().lastSyncedAt` — the
 *     `config/teams.yaml` mtime on the backend, NOT the data sync clock
 *     used by metrics / activity / repos (those refresh on their own
 *     cadence and aren't surfaced here).
 *   - "Data: mainnet" is shown only when the user is on `:network=test12`
 *     so they don't conflate test-chain context with real contribution
 *     data, which always comes from mainnet GitHub.
 *
 * @module components/gnolove/teams/TeamHubHeader
 */

import { useState } from "react"
import { Link } from "react-router-dom"
import type { Team } from "../../../lib/gnoloveConstants"
import { TEAM_CSS_COLORS } from "../../../lib/gnoloveConstants"
import {
    TEAM_HUB_PERIOD_LABELS,
    TEAM_HUB_PERIODS,
    type TeamHubPeriod,
} from "../../../lib/gnolovePeriod"

interface Props {
    team: Team
    period: TeamHubPeriod
    onPeriodChange: (next: TeamHubPeriod) => void
    lastSyncedAt: string | null
    networkKey: string
    backToTeamsHref: string
}

function formatRelativeTime(iso: string | null, nowMs: number): string {
    if (!iso) return "—"
    const ts = new Date(iso).getTime()
    if (Number.isNaN(ts)) return "—"
    const diff = nowMs - ts
    if (diff < 60_000) return "just now"
    const mins = Math.round(diff / 60_000)
    if (mins < 60) return `${mins}m ago`
    const hours = Math.round(mins / 60)
    if (hours < 24) return `${hours}h ago`
    const days = Math.round(hours / 24)
    return `${days}d ago`
}

export function TeamHubHeader({ team, period, onPeriodChange, lastSyncedAt, networkKey, backToTeamsHref }: Props) {
    const [nowMs] = useState(() => Date.now())
    const stripeColor = TEAM_CSS_COLORS[team.color]
    return (
        <header className="gl-thub-header" style={{ borderLeftColor: stripeColor }}>
            <div className="gl-thub-header-top">
                <Link to={backToTeamsHref} className="gl-profile-back">&larr; Back to Teams</Link>
                <div className="gl-thub-header-chips">
                    <span
                        className="gl-thub-chip gl-thub-chip-sync"
                        title={lastSyncedAt
                            ? `Team config (teams.yaml) deployed ${new Date(lastSyncedAt).toISOString()}`
                            : "no roster sync yet"}
                    >
                        Roster updated: {formatRelativeTime(lastSyncedAt, nowMs)}
                    </span>
                    {networkKey === "test12" && (
                        <span className="gl-thub-chip gl-thub-chip-network" role="note">
                            Data: mainnet
                        </span>
                    )}
                </div>
            </div>

            <div className="gl-thub-header-body">
                <div>
                    <h1 className="gl-title" style={{ color: stripeColor, marginBottom: 4 }}>{team.name}</h1>
                    {team.description && <p className="gl-team-profile-desc">{team.description}</p>}
                </div>
                <div className="gl-thub-period">
                    <span className="gl-thub-period-label" id="gl-thub-period-label">Period</span>
                    <div className="gl-tabs" role="tablist" aria-labelledby="gl-thub-period-label">
                        {TEAM_HUB_PERIODS.map(p => (
                            <button
                                key={p}
                                type="button"
                                role="tab"
                                className={`gl-tab ${period === p ? "gl-tab--active" : ""}`}
                                aria-selected={period === p}
                                aria-current={period === p ? "page" : undefined}
                                onClick={() => onPeriodChange(p)}
                            >
                                {TEAM_HUB_PERIOD_LABELS[p]}
                            </button>
                        ))}
                    </div>
                </div>
            </div>
        </header>
    )
}
