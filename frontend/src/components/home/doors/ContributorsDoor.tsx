/**
 * ContributorsDoor — visitor showcase door for top Gnolove contributors.
 *
 * variant="list", eyebrow "top contributors".
 * Data source: useGnoloveHighlights (reuses GnolovePanel's hook — no new fetch).
 *
 * State mapping:
 *   - loading: Door skeleton (Gnolove is an off-chain HTTP call; resolves quickly).
 *   - ready (top.length > 0): top 3 contributors (login + score). Link → gnolove.
 *   - empty (top.length === 0, not loading): invitation to Open Gnolove.
 *     Never renders "0" or "—" — blank contributor count is simply omitted.
 *
 * Refetch: useGnoloveHighlights wraps react-query but does not surface a
 * refetch in its returned interface (returns only top/contributorCount/loading).
 * No onRetry is wired — the Door does not render a retry button in the empty
 * state (empty → invitation, not error). The hook will retry automatically via
 * react-query's default behavior. If a genuine error path is needed in future,
 * surface query.refetch from useGnoloveHighlights and wire it here.
 *
 * @module components/home/doors/ContributorsDoor
 */

import { Link } from "react-router-dom"
import { Door } from "../Door"
import { useGnoloveHighlights } from "../../../hooks/home/useGnoloveHighlights"
import "../home.css"

export interface ContributorsDoorProps {
    networkKey: string
}

/** Render initials from a login (up to 2 chars, uppercased). */
function initials(login: string): string {
    const parts = login.split(/[-_\s]/)
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
    return login.slice(0, 2).toUpperCase()
}

export function ContributorsDoor({ networkKey }: ContributorsDoorProps) {
    const { top, loading } = useGnoloveHighlights()

    const gnoloveHref = `/${networkKey}/gnolove`

    if (loading) {
        return (
            <Door
                variant="list"
                state="loading"
                eyebrow="top contributors"
            />
        )
    }

    // Empty: no contributors yet — show invitation to gnolove.
    if (top.length === 0) {
        return (
            <Door
                variant="list"
                state="empty"
                eyebrow="top contributors"
                invitation={{ label: "Open Gnolove", href: gnoloveHref }}
            />
        )
    }

    return (
        <Door variant="list" state="ready" eyebrow="top contributors">
            <div className="contributors-door">
                <ol className="contributors-door__list">
                    {top.map((entry, i) => (
                        <li key={entry.login} className="contributors-door__entry">
                            <span className="contributors-door__rank">#{i + 1}</span>
                            <span className="contributors-door__avatar" aria-hidden="true">
                                {initials(entry.login)}
                            </span>
                            <span className="contributors-door__login">{entry.login}</span>
                            <span className="contributors-door__score">{entry.score}</span>
                        </li>
                    ))}
                </ol>
                <Link to={gnoloveHref} className="contributors-door__link">
                    Open Gnolove
                </Link>
            </div>
        </Door>
    )
}
