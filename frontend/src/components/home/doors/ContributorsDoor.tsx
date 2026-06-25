/**
 * ContributorsDoor — visitor showcase door for top Gnolove contributors.
 *
 * variant="list", eyebrow "top contributors". Data: useGnoloveHighlights.
 * Shows the top-3 with a real avatar (Gnolove/GitHub image, initials fallback)
 * and a score bar (relative to the #1 contributor). Honesty: empty → invitation,
 * never a "0"/"—".
 *
 * @module components/home/doors/ContributorsDoor
 */
import { useState } from "react"
import { Door } from "../Door"
import { useGnoloveHighlights } from "../../../hooks/home/useGnoloveHighlights"
import "../home.css"

export interface ContributorsDoorProps {
    networkKey: string
}

/** Render initials from a login (up to 2 chars, uppercased). */
function initials(login: string): string {
    const parts = login.split(/[-_\s]/).filter(Boolean)
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
    return login.slice(0, 2).toUpperCase()
}

/** Real contributor avatar with initials fallback on absence or load error. */
function ContributorAvatar({ login, avatarUrl }: { login: string; avatarUrl?: string }) {
    const [failed, setFailed] = useState(false)
    if (avatarUrl && !failed) {
        return (
            <img
                src={avatarUrl}
                alt=""
                aria-hidden="true"
                loading="lazy"
                className="contributors-door__avatar contributors-door__avatar--img"
                onError={() => setFailed(true)}
            />
        )
    }
    return (
        <span className="contributors-door__avatar" aria-hidden="true">
            {initials(login)}
        </span>
    )
}

export function ContributorsDoor({ networkKey }: ContributorsDoorProps) {
    const { top, loading } = useGnoloveHighlights()

    const gnoloveHref = `/${networkKey}/gnolove`

    if (loading) {
        return <Door variant="list" state="loading" eyebrow="top contributors" />
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

    const topScore = top[0]?.score || 0

    // The WHOLE card is the link (href on Door) — no inner footer <Link>, which
    // would be an illegal nested <a> inside the card-link.
    return (
        <Door variant="list" state="ready" eyebrow="top contributors" href={gnoloveHref}>
            <div className="contributors-door">
                <ol className="contributors-door__list">
                    {top.map((entry, i) => {
                        const pct = topScore > 0 ? Math.round((entry.score / topScore) * 100) : 0
                        return (
                            <li key={entry.login} className="contributors-door__entry">
                                <div className="contributors-door__row">
                                    <span className="contributors-door__rank">#{i + 1}</span>
                                    <ContributorAvatar login={entry.login} avatarUrl={entry.avatarUrl} />
                                    <span className="contributors-door__login">{entry.login}</span>
                                    <span className="contributors-door__score">{entry.score}</span>
                                </div>
                                <div className="contributors-door__bar" aria-hidden="true">
                                    <div className="contributors-door__bar-fill" style={{ width: `${pct}%` }} />
                                </div>
                            </li>
                        )
                    })}
                </ol>
            </div>
        </Door>
    )
}
