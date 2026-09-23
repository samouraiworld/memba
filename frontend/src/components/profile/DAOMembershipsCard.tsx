/**
 * DAOMembershipsCard — Shows DAO memberships on the user profile.
 *
 * Reads saved DAOs from localStorage and displays tier, realm path, and a link
 * to each DAO. Shows member/viewer distinction based on wallet connection.
 *
 * v2.0.0-alpha.1 (Sprint B, Step 9)
 */

import { useNetworkNav } from "../../hooks/useNetworkNav"
import { encodeSlug, getSavedDAOs, type SavedDAO } from "../../lib/daoSlug"
import { revealInvisibleFormatting } from "../../lib/dao/v2Text"

interface Props {
    /** The profile's wallet address. */
    address: string
    /** Whether this is the current user's own profile. */
    isOwnProfile: boolean
}

export function DAOMembershipsCard(props: Props) {
    const navigate = useNetworkNav()

    // Only show saved DAOs for own profile (localStorage is per-user)
    if (!props.isOwnProfile) return null

    const savedDAOs: SavedDAO[] = getSavedDAOs()
    if (savedDAOs.length === 0) return null

    return (
        <div className="k-card" style={{ padding: 20 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                <h3 style={{ fontSize: "var(--pro-body, 14px)", fontWeight: 600, color: "var(--color-text)" }}>
                    🏛️ DAO Memberships ({savedDAOs.length})
                </h3>
                <button
                    onClick={() => navigate("/dao")}
                    style={{
                        fontSize: "var(--pro-caption, 10px)", color: "var(--color-primary)", background: "none",
                        border: "none", cursor: "pointer",
                        fontFamily: "var(--font-ui, JetBrains Mono, monospace)",
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
                            border: "1px solid var(--color-surface-base)",
                            transition: "border-color 0.15s",
                        }}
                        onMouseEnter={e => e.currentTarget.style.borderColor = "rgba(0,212,170,0.2)"}
                        onMouseLeave={e => e.currentTarget.style.borderColor = "var(--color-surface-base)"}
                    >
                        <div>
                            <div style={{ fontSize: "var(--pro-small, 13px)", fontWeight: 500, color: "var(--color-text)" }}>
                                {revealInvisibleFormatting(dao.name)}
                            </div>
                            <div style={{
                                fontSize: "var(--pro-caption, 10px)", fontFamily: "JetBrains Mono, monospace",
                                color: "var(--color-text-muted)", marginTop: 2,
                            }}>
                                {dao.realmPath}
                            </div>
                        </div>
                        <span style={{
                            fontSize: "var(--pro-caption, 9px)", padding: "2px 8px", borderRadius: 4,
                            background: "rgba(0,212,170,0.08)", color: "var(--color-primary)",
                            fontFamily: "var(--font-ui, JetBrains Mono, monospace)", fontWeight: 600,
                        }}>
                            MEMBER
                        </span>
                    </button>
                ))}
            </div>
        </div>
    )
}
