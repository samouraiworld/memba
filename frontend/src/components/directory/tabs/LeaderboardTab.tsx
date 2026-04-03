/**
 * Leaderboard Tab — Directory tab showing top gnolove contributors.
 * Extracted from Directory.tsx for maintainability.
 * @module components/directory/tabs/LeaderboardTab
 */

import { useState, useEffect } from "react"
import { getContributors } from "../../../lib/gnoloveApi"
import type { TEnhancedUserWithStats } from "../../../lib/gnoloveSchemas"
import { SkeletonCard } from "../../ui/LoadingSkeleton"
import type { TabProps } from "./types"

export function LeaderboardTab({ navigate }: TabProps) {
    const [contributors, setContributors] = useState<TEnhancedUserWithStats[]>([])
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        let cancelled = false
        getContributors()
            .then(res => { if (!cancelled) setContributors(res?.users?.slice(0, 20) || []) })
            .catch(() => { if (!cancelled) setContributors([]) })
            .finally(() => { if (!cancelled) setLoading(false) })
        return () => { cancelled = true }
    }, [])

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div className="dir-govdao-header">
                <div>
                    <h3 className="dir-govdao-title">Top Contributors</h3>
                    <p className="dir-govdao-desc">Most active Gno ecosystem contributors tracked by gnolove</p>
                </div>
                <button
                    className="k-btn-primary"
                    style={{ fontSize: 11, padding: "6px 14px", whiteSpace: "nowrap" }}
                    onClick={() => navigate("/gnolove")}
                >
                    Full Leaderboard →
                </button>
            </div>

            {loading ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    <SkeletonCard /><SkeletonCard /><SkeletonCard />
                </div>
            ) : contributors.length === 0 ? (
                <div className="dir-empty"><p>No contributor data available</p></div>
            ) : (
                <div className="dir-govdao-list">
                    {contributors.map((c, i) => (
                        <button
                            key={c.login}
                            className="dir-govdao-card"
                            onClick={() => navigate(`/gnolove`)}
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
