/**
 * DashboardDAOList — Shows user's DAO memberships on the dashboard.
 *
 * Each card includes:
 * - DAO name + realm path
 * - PINNED badge + active proposal count
 * - Collapsible accordion with quick-navigation buttons
 *
 * v2.1: PINNED badge, async activity data, enriched card design.
 */
import { useState, useCallback, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { encodeSlug, type SavedDAO } from "../../lib/daoSlug"
import { getDAOConfig, getDAOProposals } from "../../lib/dao"
import { GNO_RPC_URL } from "../../lib/config"

interface DAOActivity {
    activeProposals: number
    totalProposals: number
    memberCount: number
    threshold: string
}

interface Props {
    savedDAOs: SavedDAO[]
    userAddress: string | null
}

export function DashboardDAOList({ savedDAOs }: Props) {
    const navigate = useNavigate()
    const [expanded, setExpanded] = useState<Record<string, boolean>>({})
    const [activity, setActivity] = useState<Record<string, DAOActivity>>({})

    const toggle = useCallback((path: string, e: React.MouseEvent) => {
        e.stopPropagation()
        setExpanded(prev => ({ ...prev, [path]: !prev[path] }))
    }, [])

    // Fetch activity data for all saved DAOs
    useEffect(() => {
        if (savedDAOs.length === 0) return
        savedDAOs.forEach(async (dao) => {
            try {
                const [cfg, proposals] = await Promise.all([
                    getDAOConfig(GNO_RPC_URL, dao.realmPath),
                    getDAOProposals(GNO_RPC_URL, dao.realmPath),
                ])
                const active = proposals.filter(p => p.status === "open").length
                setActivity(prev => ({
                    ...prev,
                    [dao.realmPath]: {
                        activeProposals: active,
                        totalProposals: proposals.length,
                        memberCount: cfg?.memberCount || 0,
                        threshold: cfg?.threshold || "—",
                    },
                }))
            } catch { /* silently fail — card still works without activity data */ }
        })
    }, [savedDAOs])

    return (
        <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
                <span style={{ fontSize: 14 }}>🏛️</span>
                <h3 style={{ fontSize: 16, fontWeight: 500 }}>My DAOs</h3>
                <span className="k-label" style={{ marginLeft: "auto" }}>
                    {savedDAOs.length} {savedDAOs.length === 1 ? "DAO" : "DAOs"}
                </span>
            </div>

            {savedDAOs.length === 0 ? (
                <div className="k-card" style={{ textAlign: "center", padding: 32 }}>
                    <p style={{ color: "#555", fontSize: 13, fontFamily: "JetBrains Mono, monospace", marginBottom: 12 }}>
                        No DAOs yet
                    </p>
                    <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
                        <button className="k-btn-primary" style={{ fontSize: 11, padding: "6px 14px" }} onClick={() => navigate("/dao")}>
                            Explore DAOs →
                        </button>
                        <button className="k-btn-secondary" style={{ fontSize: 11, padding: "6px 14px" }} onClick={() => navigate("/dao/create")}>
                            + Create
                        </button>
                    </div>
                </div>
            ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12 }}>
                    {savedDAOs.map(dao => {
                        const isExpanded = expanded[dao.realmPath] ?? false
                        const act = activity[dao.realmPath]
                        return (
                            <div
                                key={dao.realmPath}
                                className="k-card"
                                style={{ cursor: "pointer", transition: "border-color 0.15s", padding: "16px 18px" }}
                                onMouseEnter={e => e.currentTarget.style.borderColor = "rgba(0,212,170,0.3)"}
                                onMouseLeave={e => e.currentTarget.style.borderColor = ""}
                            >
                                {/* Card header — click navigates */}
                                <div
                                    onClick={() => navigate(`/dao/${encodeSlug(dao.realmPath)}`)}
                                    style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}
                                >
                                    <span style={{ fontWeight: 600, fontSize: 14, color: "#f0f0f0" }}>
                                        {dao.name}
                                    </span>
                                    {/* Accordion toggle */}
                                    <button
                                        onClick={(e) => toggle(dao.realmPath, e)}
                                        aria-label={isExpanded ? "Collapse" : "Expand"}
                                        style={{
                                            background: "none", border: "none", cursor: "pointer",
                                            color: "#555", fontSize: 12, padding: "2px 6px",
                                            transition: "transform 0.2s, color 0.15s",
                                            transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)",
                                        }}
                                        onMouseEnter={e => e.currentTarget.style.color = "#00d4aa"}
                                        onMouseLeave={e => e.currentTarget.style.color = "#555"}
                                    >
                                        ▼
                                    </button>
                                </div>
                                <span
                                    style={{ fontSize: 10, fontFamily: "JetBrains Mono, monospace", color: "#555", wordBreak: "break-all", cursor: "pointer" }}
                                    onClick={() => navigate(`/dao/${encodeSlug(dao.realmPath)}`)}
                                >
                                    {dao.realmPath}
                                </span>

                                {/* Badges row */}
                                <div style={{ display: "flex", gap: 6, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
                                    <span style={{
                                        fontSize: 9, fontFamily: "JetBrains Mono, monospace",
                                        color: "#3b82f6", background: "rgba(59,130,246,0.08)",
                                        padding: "2px 6px", borderRadius: 3, fontWeight: 600,
                                    }}>
                                        📌 PINNED
                                    </span>
                                    {act && act.activeProposals > 0 && (
                                        <span style={{
                                            fontSize: 9, fontFamily: "JetBrains Mono, monospace",
                                            color: "#00d4aa", background: "rgba(0,212,170,0.08)",
                                            padding: "2px 6px", borderRadius: 3, fontWeight: 600,
                                        }}>
                                            📋 {act.activeProposals} active
                                        </span>
                                    )}
                                    {act && act.totalProposals > 0 && (
                                        <span style={{
                                            fontSize: 9, fontFamily: "JetBrains Mono, monospace",
                                            color: "#888", background: "rgba(255,255,255,0.04)",
                                            padding: "2px 6px", borderRadius: 3,
                                        }}>
                                            {act.totalProposals} total
                                        </span>
                                    )}
                                    {act && act.memberCount > 0 && (
                                        <span style={{
                                            fontSize: 9, fontFamily: "JetBrains Mono, monospace",
                                            color: "#888", background: "rgba(255,255,255,0.04)",
                                            padding: "2px 6px", borderRadius: 3,
                                        }}>
                                            👥 {act.memberCount}
                                        </span>
                                    )}
                                </div>

                                {/* Activity summary */}
                                {act && (
                                    <div style={{ marginTop: 8, fontSize: 10, fontFamily: "JetBrains Mono, monospace", color: "#555" }}>
                                        Threshold: {act.threshold} • {act.memberCount} members
                                    </div>
                                )}

                                {/* Accordion body */}
                                {isExpanded && (
                                    <div style={{
                                        marginTop: 10, paddingTop: 10,
                                        borderTop: "1px solid rgba(255,255,255,0.05)",
                                        animation: "fadeIn 0.2s ease-out",
                                    }}>
                                        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                                            <button
                                                className="k-btn-primary"
                                                style={{ fontSize: 10, padding: "4px 10px", flex: 1 }}
                                                onClick={(e) => { e.stopPropagation(); navigate(`/dao/${encodeSlug(dao.realmPath)}`) }}
                                            >
                                                View DAO →
                                            </button>
                                            <button
                                                className="k-btn-secondary"
                                                style={{ fontSize: 10, padding: "4px 10px" }}
                                                onClick={(e) => { e.stopPropagation(); navigate(`/dao/${encodeSlug(dao.realmPath)}/propose`) }}
                                            >
                                                + New Proposal
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )
                    })}
                </div>
            )}
        </div>
    )
}
