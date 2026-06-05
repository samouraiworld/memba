/**
 * GnoloveNotablePRs — read-only mirror of the gnolang "Notable PRs" GitHub
 * Project board (org project #66, https://github.com/orgs/gnolang/projects/66).
 *
 * The board gathers PRs that need review or help so area leaders can find
 * important PRs and reviewers. Items are grouped by the board's "Status"
 * column. Data comes from the gnolove backend's /projects/notable route, which
 * mirrors the board on its 2h sync — so this page needs no GitHub auth itself.
 *
 * Note: the backend can only populate the board once its GITHUB_API_TOKEN
 * carries the `read:project` scope; until then this page shows an empty state.
 *
 * @module pages/gnolove/GnoloveNotablePRs
 */

import { useMemo } from "react"
import { Link } from "react-router-dom"
import { useNotablePRs } from "../../hooks/gnolove"
import { useNetworkPath } from "../../hooks/useNetworkNav"
import { PageMeta } from "../../components/gnolove/PageMeta"
import type { TNotablePR } from "../../lib/gnoloveSchemas"

const PROJECT_URL = "https://github.com/orgs/gnolang/projects/66/views/1"
const UNGROUPED = "Other"

function reviewLabel(pr: TNotablePR): { text: string; tone: string } | null {
    if (pr.state === "MERGED") return { text: "Merged", tone: "#8957e5" }
    if (pr.state === "CLOSED") return { text: "Closed", tone: "#cf222e" }
    if (pr.isDraft) return { text: "Draft", tone: "#6e7781" }
    switch (pr.reviewDecision) {
        case "APPROVED": return { text: "Approved", tone: "#1a7f37" }
        case "CHANGES_REQUESTED": return { text: "Changes requested", tone: "#cf222e" }
        case "REVIEW_REQUIRED": return { text: "Review required", tone: "#bf8700" }
        default: return null
    }
}

export default function GnoloveNotablePRs() {
    const np = useNetworkPath()
    const { data, isLoading, isError } = useNotablePRs()

    // Group by board Status column, preserving first-seen group order.
    const groups = useMemo(() => {
        const byStatus = new Map<string, TNotablePR[]>()
        for (const pr of data ?? []) {
            const key = pr.status?.trim() || UNGROUPED
            const bucket = byStatus.get(key)
            if (bucket) bucket.push(pr)
            else byStatus.set(key, [pr])
        }
        return Array.from(byStatus.entries())
    }, [data])

    const total = data?.length ?? 0

    return (
        <div className="gl-page">
            <PageMeta
                title="Notable PRs | Gnolove · Memba"
                description="Pull requests from the gnolang Notable PRs board that need review or help."
            />
            <Link to={np("gnolove")} className="gl-profile-back">← Back to Contributors Overview</Link>
            <div className="gl-header">
                <h1 className="gl-title">Notable PRs</h1>
                <a
                    href={PROJECT_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="gl-thub-chip"
                    title="Open the gnolang Notable PRs board on GitHub"
                >
                    gnolang/projects #66 ↗
                </a>
            </div>
            <p className="gl-team-profile-desc" style={{ marginTop: 0 }}>
                PRs the Gno core team flagged as needing review or help. Mirrored from the{" "}
                <a href={PROJECT_URL} target="_blank" rel="noopener noreferrer">Notable PRs project board</a>.
            </p>

            {isLoading && <p className="gl-team-profile-desc">Loading notable PRs…</p>}

            {isError && (
                <p className="gl-team-profile-desc" role="alert">
                    Couldn't load the notable PRs board right now. Please try again later.
                </p>
            )}

            {!isLoading && !isError && total === 0 && (
                <p className="gl-team-profile-desc">
                    No notable PRs to show yet. The board mirror populates once the gnolove
                    backend has GitHub project read access; in the meantime you can view it{" "}
                    <a href={PROJECT_URL} target="_blank" rel="noopener noreferrer">directly on GitHub</a>.
                </p>
            )}

            {groups.map(([status, prs]) => (
                <section key={status} style={{ marginTop: 24 }}>
                    <h2 className="gl-title" style={{ fontSize: 18, marginBottom: 8 }}>
                        {status} <span style={{ color: "#6e7781", fontWeight: 400 }}>({prs.length})</span>
                    </h2>
                    <div className="gl-teams-list">
                        {prs.map(pr => {
                            const badge = reviewLabel(pr)
                            return (
                                <a
                                    key={pr.itemID}
                                    href={pr.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="gl-teams-panel"
                                    style={{ textDecoration: "none" }}
                                >
                                    <div className="gl-teams-panel-header">
                                        <div className="gl-teams-panel-title">
                                            <span style={{ fontSize: 15, fontWeight: 600 }}>{pr.title}</span>
                                        </div>
                                        {badge && (
                                            <span
                                                className="gl-teams-panel-stats"
                                                style={{ color: badge.tone, fontWeight: 600 }}
                                            >
                                                {badge.text}
                                            </span>
                                        )}
                                    </div>
                                    <div className="gl-teams-panel-socials">
                                        <span className="gl-teams-panel-social">{pr.repository}#{pr.number}</span>
                                        {pr.authorLogin && (
                                            <span className="gl-teams-panel-social">@{pr.authorLogin}</span>
                                        )}
                                    </div>
                                </a>
                            )
                        })}
                    </div>
                </section>
            ))}
        </div>
    )
}
