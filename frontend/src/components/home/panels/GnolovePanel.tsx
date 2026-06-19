/**
 * GnolovePanel — top-contributors preview for the StateBoard.
 *
 * Per-panel graceful-degradation contract (same as NetworkPulsePanel):
 *   - NEVER throw during render — degrade to "—" on error or no data
 *   - NEVER blank — always show the card structure (skeleton while loading)
 *   - Loading: show skeleton ActionCards
 *   - Error / no data: show "—" per row
 *
 * Renders a mini leaderboard: rank + login + score for the top 3 contributors
 * (score in monospace), a "N contributors" footer, and a CTA to /gnolove.
 *
 * @module components/home/panels/GnolovePanel
 */

import { useGnoloveHighlights } from "../../../hooks/home/useGnoloveHighlights"
import { useNetwork } from "../../../hooks/useNetwork"
import { ActionCard } from "../ActionCard"
import "../home.css"

/** Rank prefix for positions 1–3. */
function rankLabel(i: number): string {
    return `#${i + 1}`
}

/** Format a score for display — returns "—" when it is not a positive number. */
function fmtScore(score: number | undefined | null): string {
    if (score === undefined || score === null || score < 0) return "—"
    return String(score)
}

/**
 * GnolovePanel — state-board panel for everyone (member + visitor).
 * Shows the top 3 Gnolove contributors and a CTA to the full leaderboard.
 */
export function GnolovePanel() {
    const { top, contributorCount, loading } = useGnoloveHighlights()
    const { networkKey } = useNetwork()

    const gnoloveHref = `/${networkKey}/gnolove`

    // Loading: 3 skeleton cards + 1 footer skeleton
    if (loading) {
        return (
            <div className="gnolove-panel" data-testid="gnolove-panel">
                <ActionCard title="…" loading={true} />
                <ActionCard title="…" loading={true} />
                <ActionCard title="…" loading={true} />
                <ActionCard title="…" loading={true} />
            </div>
        )
    }

    // Error or empty — degrade to "—" row
    const rows =
        top.length > 0
            ? top
            : [
                  { login: "—", score: -1 },
                  { login: "—", score: -1 },
                  { login: "—", score: -1 },
              ]

    const countLabel =
        contributorCount > 0 ? `${contributorCount} contributors` : "—"

    return (
        <div className="gnolove-panel" data-testid="gnolove-panel">
            {rows.map((entry, i) => (
                <ActionCard
                    key={entry.login === "—" ? `dash-${i}` : entry.login}
                    accent={i === 0 ? "teal" : "neutral"}
                    icon="user"
                    eyebrow={rankLabel(i)}
                    title={entry.login}
                    meta={
                        entry.score >= 0
                            ? `score: ${fmtScore(entry.score)}`
                            : undefined
                    }
                />
            ))}
            <ActionCard
                accent="neutral"
                icon="trophy"
                eyebrow={countLabel}
                title="Open Gnolove"
                href={gnoloveHref}
                actionLabel="Open Gnolove ->"
            />
        </div>
    )
}
