/**
 * GovDAO Tab — Directory tab showing GovDAO governance proposals.
 * Extracted from Directory.tsx for maintainability.
 * @module components/directory/tabs/GovDAOTab
 */

import { useQuery } from "@tanstack/react-query"
import { ArrowRight } from "@phosphor-icons/react"
import { GNO_RPC_URL, GNO_CHAIN_ID } from "../../../lib/config"
import { encodeSlug } from "../../../lib/daoSlug"
import { fetchVerifiedDirectoryGovDAOProposals } from "../../../lib/directoryGovDao"
import { formatRelativeTime } from "../../../lib/blockTime"
import { SkeletonCard } from "../../ui/LoadingSkeleton"
import type { TabProps } from "./types"

const GOVDAO_PATH = "gno.land/r/gov/dao"

export function GovDAOTab({ navigate }: TabProps) {
    const query = useQuery({
        queryKey: ["directory", "govdao", GNO_CHAIN_ID],
        queryFn: () => fetchVerifiedDirectoryGovDAOProposals(GNO_RPC_URL, GOVDAO_PATH),
        retry: false,
    })
    const proposals = query.data?.slice(0, 20) ?? []

    const statusColor = (s: string) => {
        if (s === "open") return "var(--color-brand)"
        if (s === "passed") return "var(--color-accent-gold)"
        if (s === "executed") return "var(--color-info)"
        if (s === "failed" || s === "rejected") return "var(--color-danger)"
        return "var(--color-text-secondary)"
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
                    style={{ fontSize: "var(--pro-caption, 11px)", padding: "6px 14px", whiteSpace: "nowrap" }}
                    onClick={() => navigate(`/dao/${encodeSlug(GOVDAO_PATH)}`)}
                >
                    Open GovDAO →
                </button>
            </div>

            {query.isPending ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    <SkeletonCard /><SkeletonCard /><SkeletonCard />
                </div>
            ) : query.isError ? (
                <div className="dir-error" role="status"><p>{query.error instanceof Error ? query.error.message : "Failed to load GovDAO proposals"}</p><button type="button" className="k-btn-secondary" onClick={() => void query.refetch()}>Retry</button></div>
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
