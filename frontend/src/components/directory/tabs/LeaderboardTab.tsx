/**
 * Leaderboard Tab — Directory tab showing top gnolove contributors.
 * Extracted from Directory.tsx for maintainability.
 * @module components/directory/tabs/LeaderboardTab
 */

import { useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { getContributors } from "../../../lib/gnoloveApi"
import type { TEnhancedUserWithStats } from "../../../lib/gnoloveSchemas"
import { SkeletonCard } from "../../ui/LoadingSkeleton"
import type { TabProps } from "./types"

export function LeaderboardTab({ navigate }: TabProps) {
    const query = useQuery({
        queryKey: ["directory", "leaderboard"],
        queryFn: ({ signal }) => getContributors(undefined, undefined, undefined, signal),
        retry: false,
    })
    const contributors = useMemo<TEnhancedUserWithStats[]>(() => [...(query.data?.users ?? [])]
        .sort((a, b) => b.score - a.score || a.login.localeCompare(b.login))
        .slice(0, 20), [query.data])

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div className="dir-govdao-header">
                <div>
                    <h3 className="dir-govdao-title">Top Contributors</h3>
                    <p className="dir-govdao-desc">Top contributors by gnolove score</p>
                </div>
                <button
                    className="k-btn-primary"
                    style={{ fontSize: "var(--pro-caption, 11px)", padding: "6px 14px", whiteSpace: "nowrap" }}
                    onClick={() => navigate("/gnolove")}
                >
                    Full Leaderboard →
                </button>
            </div>

            {query.isPending ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    <SkeletonCard /><SkeletonCard /><SkeletonCard />
                </div>
            ) : query.isError ? (
                <div className="dir-error" role="status"><p>Contributor data is unavailable.</p><button type="button" className="k-btn-secondary" onClick={() => void query.refetch()}>Retry</button></div>
            ) : contributors.length === 0 ? (
                <div className="dir-empty"><p>No contributor data available</p></div>
            ) : (
                <div className="dir-govdao-list">
                    {contributors.map((c, i) => (
                        <button
                            key={c.login}
                            className="dir-govdao-card"
                            onClick={() => navigate(`/gnolove/contributor/${encodeURIComponent(c.login)}`)}
                        >
                            <div className="dir-lb-rank">#{i + 1}</div>
                            <img
                                src={c.avatarUrl}
                                alt={c.login}
                                className="dir-lb-avatar"
                            />
                            <div className="dir-govdao-card__main">
                                <div className="dir-govdao-card__title">
                                    {c.name || c.login}
                                </div>
                                <div className="dir-govdao-card__meta">
                                    <span className="dir-govdao-votes">
                                        {c.TotalCommits} commits · {c.TotalPrs} PRs · {c.TotalIssues} issues
                                    </span>
                                </div>
                            </div>
                            <div className="dir-lb-score">
                                {c.score}
                            </div>
                        </button>
                    ))}
                </div>
            )}
        </div>
    )
}
