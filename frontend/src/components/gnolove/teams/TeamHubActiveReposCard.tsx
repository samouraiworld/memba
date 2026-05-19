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
}

function RepoRow({ repo, bucket }: { repo: TActiveRepo; bucket: "primary" | "secondary" }) {
    const [owner, name] = repo.repoId.split("/")
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
            <span className="gl-thub-active-repo-count" title={`${repo.teamPRs} of ${repo.totalPRs} merged PRs (${Math.round(repo.pctOfRepo * 100)}% of repo)`}>
                {repo.teamPRs}
                <span className="gl-thub-active-repo-of">/ {repo.totalPRs}</span>
            </span>
        </a>
    )
}

export function TeamHubActiveReposCard({ data, isLoading }: Props) {
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

    const primary = data?.primary ?? []
    const secondary = data?.secondary ?? []
    const empty = primary.length === 0 && secondary.length === 0

    return (
        <div className="gl-thub-card">
            <h2 className="gl-thub-card-title">Active repositories</h2>
            <div aria-live="polite" aria-label="Active repositories for the selected period">

            {empty && (
                <p className="gl-thub-empty">No tracked-repo activity for this team in the selected period.</p>
            )}

            {primary.length > 0 && (
                <section className="gl-thub-active-bucket">
                    <h3 className="gl-thub-active-bucket-title">Primary</h3>
                    <p className="gl-thub-active-bucket-hint">
                        &gt; 2% of team’s merged PRs <em>and</em> &gt; 5% of the repo’s merged PRs.
                    </p>
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
