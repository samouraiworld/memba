/**
 * TeamHubActiveReposCard — primary vs secondary repos from the dual-threshold rule.
 *
 * The backend ranks by team PRs desc within each bucket; this component
 * just walks the lists and shows the team's share. Empty primary is the
 * common case for small teams in a short period — we still show the card,
 * just with an honest "nothing this period" line.
 *
 * @module components/gnolove/teams/TeamHubActiveReposCard
 */

import type { TActiveReposResponse, TActiveRepo } from "../../../lib/gnoloveSchemas"

interface Props {
    data: TActiveReposResponse | null | undefined
    isLoading: boolean
    isError: boolean
    onRetry: () => void
}

function RepoRow({ repo, bucket }: { repo: TActiveRepo; bucket: "primary" | "secondary" }) {
    const [owner, name] = repo.repoId.split("/")
    const pctOfRepo = Math.round(repo.pctOfRepo * 100)
    const pctOfTeam = Math.round(repo.pctOfTeam * 100)
    return (
        <a
            href={`https://github.com/${repo.repoId}`}
            target="_blank"
            rel="noopener noreferrer"
            className={`gl-thub-active-repo gl-thub-active-repo-${bucket}`}
        >
            <span className="gl-thub-active-repo-name">
                <span className="gl-thub-active-repo-owner">{owner}/</span>{name}
            </span>
            <span
                className="gl-thub-active-repo-count"
                title={`${repo.teamPRs} of ${repo.totalPRs} merged PRs in this repo · ${pctOfTeam}% of the team's PRs land here`}
            >
                <span className="gl-thub-active-repo-pct">{pctOfRepo}%</span>
                <span className="gl-thub-active-repo-of">{repo.teamPRs}/{repo.totalPRs}</span>
            </span>
        </a>
    )
}

export function TeamHubActiveReposCard({ data, isLoading, isError, onRetry }: Props) {
    if (isLoading && !data) {
        return (
            <div className="gl-thub-card" aria-busy="true">
                <h2 className="gl-thub-card-title">Active repositories</h2>
                <ul className="gl-thub-active-list gl-thub-active-list-skel" aria-hidden="true">
                    {Array.from({ length: 4 }).map((_, i) => (
                        <li key={i} className="gl-thub-active-repo-skel">
                            <span className="gl-skeleton gl-thub-skel-repo-name" />
                            <span className="gl-skeleton gl-thub-skel-repo-count" />
                        </li>
                    ))}
                </ul>
            </div>
        )
    }

    const hasFailed = isError || (!isLoading && data == null)
    const primary = data?.primary ?? []
    const secondary = data?.secondary ?? []
    const empty = !hasFailed && primary.length === 0 && secondary.length === 0

    return (
        <div className="gl-thub-card">
            <h2 className="gl-thub-card-title">Active repositories</h2>
            <span className="gl-sr-only" aria-live="polite">
                {hasFailed ? "Data unavailable" : empty ? "No active repositories" : `${primary.length + secondary.length} repositories`}
            </span>
            <div aria-label="Active repositories for the selected period">

            {hasFailed && (
                <p className="gl-thub-empty" role="status">
                    Active-repos data unavailable. The backend didn't return data for this period.
                    {" "}<button className="gl-thub-inline-retry" onClick={onRetry}>Retry</button>
                </p>
            )}

            {empty && (
                <p className="gl-thub-empty">No tracked-repo activity for this team in the selected period.</p>
            )}

            {primary.length > 0 && (
                <section className="gl-thub-active-bucket">
                    <h3 className="gl-thub-active-bucket-title">
                        Primary
                        <details className="gl-thub-methodology">
                            <summary className="gl-thub-methodology-toggle">?</summary>
                            <span>&gt; 2% of team’s merged PRs <em>and</em> &gt; 5% of the repo’s merged PRs.</span>
                        </details>
                    </h3>
                    <ul className="gl-thub-active-list">
                        {primary.map(r => (
                            <li key={r.repoId}><RepoRow repo={r} bucket="primary" /></li>
                        ))}
                    </ul>
                </section>
            )}

            {secondary.length > 0 && (
                <section className="gl-thub-active-bucket">
                    <h3 className="gl-thub-active-bucket-title">Also contributes to</h3>
                    <ul className="gl-thub-active-list">
                        {secondary.map(r => (
                            <li key={r.repoId}><RepoRow repo={r} bucket="secondary" /></li>
                        ))}
                    </ul>
                </section>
            )}
            </div>
        </div>
    )
}
