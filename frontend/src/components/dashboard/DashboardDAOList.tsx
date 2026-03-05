/**
 * DashboardDAOList — Shows user's DAO memberships on the dashboard.
 *
 * Pure presentational component: receives saved DAO paths from parent,
 * displays them as clickable cards. Always visible (empty state if 0 DAOs).
 */
import { useNavigate } from "react-router-dom"
import { encodeSlug, type SavedDAO } from "../../lib/daoSlug"

interface Props {
    savedDAOs: SavedDAO[]
    userAddress: string | null
}

export function DashboardDAOList({ savedDAOs, userAddress }: Props) {
    const navigate = useNavigate()

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
                        return (
                            <div
                                key={dao.realmPath}
                                className="k-card"
                                onClick={() => navigate(`/dao/${encodeSlug(dao.realmPath)}`)}
                                style={{ cursor: "pointer", transition: "border-color 0.15s", padding: "16px 18px" }}
                                onMouseEnter={e => e.currentTarget.style.borderColor = "rgba(0,212,170,0.3)"}
                                onMouseLeave={e => e.currentTarget.style.borderColor = ""}
                            >
                                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                                    <span style={{ fontWeight: 600, fontSize: 14, color: "#f0f0f0" }}>
                                        {dao.name}
                                    </span>
                                </div>
                                <span style={{ fontSize: 10, fontFamily: "JetBrains Mono, monospace", color: "#555", wordBreak: "break-all" }}>
                                    {dao.realmPath}
                                </span>
                                {userAddress && (
                                    <div style={{ marginTop: 6 }}>
                                        <span style={{
                                            fontSize: 9, fontFamily: "JetBrains Mono, monospace",
                                            color: "#00d4aa", background: "rgba(0,212,170,0.08)",
                                            padding: "2px 6px", borderRadius: 3,
                                        }}>
                                            MEMBER
                                        </span>
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
