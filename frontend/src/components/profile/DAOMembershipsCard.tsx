/**
 * DAOMembershipsCard — Shows DAO memberships on the user profile.
 *
 * Reads saved DAOs from localStorage and displays tier, realm path, and a link
 * to each DAO. Shows member/viewer distinction based on wallet connection.
 *
 * v2.0.0-alpha.1 (Sprint B, Step 9)
 */

import { useNavigate } from "react-router-dom"
import { encodeSlug, getSavedDAOs, type SavedDAO } from "../../lib/daoSlug"

interface Props {
    /** The profile's wallet address. */
    address: string
    /** Whether this is the current user's own profile. */
    isOwnProfile: boolean
}

export function DAOMembershipsCard(props: Props) {
    const navigate = useNavigate()

    // Only show saved DAOs for own profile (localStorage is per-user)
    if (!props.isOwnProfile) return null

    const savedDAOs: SavedDAO[] = getSavedDAOs()
    if (savedDAOs.length === 0) return null

    return (
        <div className="k-card" style={{ padding: 20 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                <h3 style={{ fontSize: 14, fontWeight: 600, color: "#f0f0f0" }}>
                    🏛️ DAO Memberships ({savedDAOs.length})
                </h3>
                <button
                    onClick={() => navigate("/dao")}
                    style={{
                        fontSize: 10, color: "#00d4aa", background: "none",
                        border: "none", cursor: "pointer",
                        fontFamily: "JetBrains Mono, monospace",
                    }}
                >
                    Explore →
                </button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {savedDAOs.map(dao => (
                    <button
                        key={dao.realmPath}
                        onClick={() => navigate(`/dao/${encodeSlug(dao.realmPath)}`)}
                        className="k-card"
                        style={{
                            padding: "10px 14px", cursor: "pointer",
                            display: "flex", alignItems: "center", justifyContent: "space-between",
                            textAlign: "left", width: "100%",
                            border: "1px solid #1a1a1a",
                            transition: "border-color 0.15s",
                        }}
                        onMouseEnter={e => e.currentTarget.style.borderColor = "rgba(0,212,170,0.2)"}
                        onMouseLeave={e => e.currentTarget.style.borderColor = "#1a1a1a"}
                    >
                        <div>
                            <div style={{ fontSize: 13, fontWeight: 500, color: "#f0f0f0" }}>
                                {dao.name}
                            </div>
                            <div style={{
                                fontSize: 10, fontFamily: "JetBrains Mono, monospace",
                                color: "#555", marginTop: 2,
                            }}>
                                {dao.realmPath}
                            </div>
                        </div>
                        <span style={{
                            fontSize: 9, padding: "2px 8px", borderRadius: 4,
                            background: "rgba(0,212,170,0.08)", color: "#00d4aa",
                            fontFamily: "JetBrains Mono, monospace", fontWeight: 600,
                        }}>
                            MEMBER
                        </span>
                    </button>
                ))}
            </div>
        </div>
    )
}
