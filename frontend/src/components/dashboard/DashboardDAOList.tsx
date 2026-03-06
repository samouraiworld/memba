/**
 * DashboardDAOList — Shows user's DAO memberships on the dashboard.
 *
 * Each card includes a collapsible accordion showing proposal actions.
 * v2.0: Added quick-expand accordion for proposal visibility (Step 3).
 */
import { useState, useCallback } from "react"
import { useNavigate } from "react-router-dom"
import { encodeSlug, type SavedDAO } from "../../lib/daoSlug"

interface Props {
    savedDAOs: SavedDAO[]
    userAddress: string | null
}

export function DashboardDAOList({ savedDAOs, userAddress }: Props) {
    const navigate = useNavigate()
    const [expanded, setExpanded] = useState<Record<string, boolean>>({})

    const toggle = useCallback((path: string, e: React.MouseEvent) => {
        e.stopPropagation()
        setExpanded(prev => ({ ...prev, [path]: !prev[path] }))
    }, [])

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
                                <div style={{ display: "flex", gap: 6, marginTop: 6, alignItems: "center", flexWrap: "wrap" }}>
                                    <span style={{
                                        fontSize: 9, fontFamily: "JetBrains Mono, monospace",
                                        color: "#888", background: "rgba(255,255,255,0.04)",
                                        padding: "2px 6px", borderRadius: 3,
                                    }}>
                                        SAVED
                                    </span>
                                    <span style={{
                                        fontSize: 9, fontFamily: "JetBrains Mono, monospace",
                                        color: "#7b61ff", background: "rgba(123,97,255,0.08)",
                                        padding: "2px 6px", borderRadius: 3,
                                    }}>
                                        📋 Proposals
                                    </span>
                                </div>

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
                                                View Proposals →
                                            </button>
                                            <button
                                                className="k-btn-secondary"
                                                style={{ fontSize: 10, padding: "4px 10px" }}
                                                onClick={(e) => { e.stopPropagation(); navigate(`/dao/${encodeSlug(dao.realmPath)}/propose`) }}
                                            >
                                                + New
                                            </button>
                                        </div>
                                        <p style={{ color: "#444", fontSize: 9, fontFamily: "JetBrains Mono, monospace", margin: 0 }}>
                                            Click "View Proposals" to see active governance activity.
                                        </p>
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
