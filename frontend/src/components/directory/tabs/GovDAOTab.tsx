/**
 * GovDAO Tab — Directory tab showing GovDAO governance proposals.
 * Extracted from Directory.tsx for maintainability.
 * @module components/directory/tabs/GovDAOTab
 */

import { useState, useEffect } from "react"
import { ArrowRight } from "@phosphor-icons/react"
import { GNO_RPC_URL } from "../../../lib/config"
import { encodeSlug } from "../../../lib/daoSlug"
import { getDAOProposals, type DAOProposal } from "../../../lib/dao"
import { formatRelativeTime } from "../../../lib/blockTime"
import { SkeletonCard } from "../../ui/LoadingSkeleton"
import type { TabProps } from "./types"

const GOVDAO_PATH = "gno.land/r/gov/dao"

export function GovDAOTab({ navigate }: TabProps) {
    const [proposals, setProposals] = useState<DAOProposal[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        let cancelled = false
        getDAOProposals(GNO_RPC_URL, GOVDAO_PATH)
            .then(p => { if (!cancelled) setProposals(p.slice(0, 20)) })
            .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load GovDAO proposals") })
            .finally(() => { if (!cancelled) setLoading(false) })
        return () => { cancelled = true }
    }, [])

    const statusColor = (s: string) => {
        if (s === "open") return "#00d4aa"
        if (s === "passed") return "#f59e0b"
        if (s === "executed") return "#3b82f6"
        if (s === "failed" || s === "rejected") return "#ef4444"
        return "#666"
    }

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div className="dir-govdao-header">
                <div>
                    <h3 className="dir-govdao-title">GovDAO Proposals</h3>
                    <p className="dir-govdao-desc">Latest governance proposals from gno.land chain-level DAO</p>
                </div>
                <button
                    className="k-btn-primary"
                    style={{ fontSize: 11, padding: "6px 14px", whiteSpace: "nowrap" }}
                    onClick={() => navigate(`/dao/${encodeSlug(GOVDAO_PATH)}`)}
                >
                    Open GovDAO →
                </button>
            </div>

            {loading ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    <SkeletonCard /><SkeletonCard /><SkeletonCard />
                </div>
            ) : error ? (
                <div className="dir-error"><p>{error}</p></div>
            ) : proposals.length === 0 ? (
                <div className="dir-empty"><p>No proposals found</p></div>
            ) : (
                <div className="dir-govdao-list">
                    {proposals.map(p => (
                        <button
                            key={p.id}
                            className="dir-govdao-card"
                            onClick={() => navigate(`/dao/${encodeSlug(GOVDAO_PATH)}/proposal/${p.id}`)}
                        >
                            <div className="dir-govdao-card__id">#{p.id}</div>
                            <div className="dir-govdao-card__main">
                                <div className="dir-govdao-card__title">{p.title}</div>
                                <div className="dir-govdao-card__meta">
                                    <span
                                        className="dir-govdao-status"
                                        style={{ color: statusColor(p.status), borderColor: `${statusColor(p.status)}33` }}
                                    >
                                        {p.status}
                                    </span>
                                    {p.createdAt && (
                                        <span className="dir-govdao-date">
                                            {formatRelativeTime(new Date(p.createdAt))}
                                        </span>
                                    )}
                                    {p.yesVotes + p.noVotes > 0 && (
                                        <span className="dir-govdao-votes">
                                            ✓ {p.yesVotes} / ✗ {p.noVotes}
                                        </span>
                                    )}
                                </div>
                            </div>
                            <ArrowRight size={14} className="dir-arrow" />
                        </button>
                    ))}
                </div>
            )}
        </div>
    )
}
