import { useState, useEffect, useCallback } from "react"
import { useNavigate, useOutletContext } from "react-router-dom"
import { ErrorToast } from "../components/ui/ErrorToast"
import { SkeletonCard } from "../components/ui/LoadingSkeleton"
import { CopyableAddress } from "../components/ui/CopyableAddress"
import { GNO_RPC_URL, DAO_REALM_PATH } from "../lib/config"
import { getDAOMembers, type DAOMember } from "../lib/dao"
import type { LayoutContext } from "../types/layout"

export function DAOMembers() {
    const navigate = useNavigate()
    const { auth, adena } = useOutletContext<LayoutContext>()

    const [members, setMembers] = useState<DAOMember[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    const loadMembers = useCallback(async () => {
        setLoading(true)
        setError(null)
        try {
            const mems = await getDAOMembers(GNO_RPC_URL, DAO_REALM_PATH)
            setMembers(mems)
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to load members")
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => { loadMembers() }, [loadMembers])

    const isCurrentUserMember = members.some(
        (m) => m.address === adena.address,
    )

    if (loading) {
        return (
            <div className="animate-fade-in" style={{ display: "flex", flexDirection: "column", gap: 24 }}>
                <SkeletonCard />
                <SkeletonCard />
                <SkeletonCard />
            </div>
        )
    }

    return (
        <div className="animate-fade-in" style={{ display: "flex", flexDirection: "column", gap: 28 }}>
            {/* Nav */}
            <button
                onClick={() => navigate("/dao")}
                style={{ color: "#00d4aa", fontSize: 13, background: "none", border: "none", cursor: "pointer", fontFamily: "JetBrains Mono, monospace", textAlign: "left" }}
            >
                ← Back to DAO
            </button>

            {/* Header */}
            <div>
                <h2 style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em" }}>
                    👥 DAO Members ({members.length})
                </h2>
                <p style={{ color: "#888", fontSize: 12, marginTop: 6, fontFamily: "JetBrains Mono, monospace" }}>
                    Members of the {DAO_REALM_PATH.split("/").pop()} governance DAO
                </p>
            </div>

            {/* Your membership status */}
            {auth.isAuthenticated && (
                <div style={{
                    padding: "12px 16px", borderRadius: 8,
                    background: isCurrentUserMember ? "rgba(0,212,170,0.06)" : "rgba(245,166,35,0.06)",
                    border: `1px solid ${isCurrentUserMember ? "rgba(0,212,170,0.15)" : "rgba(245,166,35,0.15)"}`,
                    fontSize: 12, fontFamily: "JetBrains Mono, monospace",
                    color: isCurrentUserMember ? "#00d4aa" : "#f5a623",
                }}>
                    {isCurrentUserMember ? "✓ You are a member of this DAO" : "⚠ You are not a member of this DAO"}
                </div>
            )}

            {/* Members list */}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {members.map((member, i) => (
                    <div
                        key={member.address}
                        className="k-card"
                        style={{ padding: "16px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}
                    >
                        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                            <span style={{
                                width: 28, height: 28, borderRadius: "50%",
                                background: "rgba(0,212,170,0.08)", border: "1px solid rgba(0,212,170,0.15)",
                                display: "flex", alignItems: "center", justifyContent: "center",
                                fontSize: 11, fontFamily: "JetBrains Mono, monospace", color: "#00d4aa",
                            }}>
                                {i + 1}
                            </span>
                            <CopyableAddress address={member.address} />
                            {member.address === adena.address && (
                                <span style={{
                                    padding: "2px 6px", borderRadius: 4, fontSize: 9,
                                    fontFamily: "JetBrains Mono, monospace",
                                    background: "rgba(0,212,170,0.1)", color: "#00d4aa",
                                }}>
                                    YOU
                                </span>
                            )}
                        </div>

                        <div style={{ display: "flex", gap: 6 }}>
                            {member.roles.length > 0 ? (
                                member.roles.map((role) => (
                                    <span key={role} style={{
                                        padding: "3px 10px", borderRadius: 4, fontSize: 10,
                                        fontFamily: "JetBrains Mono, monospace", fontWeight: 500,
                                        background: roleColor(role).bg,
                                        color: roleColor(role).text,
                                    }}>
                                        {role}
                                    </span>
                                ))
                            ) : (
                                <span style={{
                                    padding: "3px 10px", borderRadius: 4, fontSize: 10,
                                    fontFamily: "JetBrains Mono, monospace",
                                    background: "rgba(255,255,255,0.03)", color: "#555",
                                }}>
                                    member
                                </span>
                            )}
                        </div>
                    </div>
                ))}
            </div>

            {members.length === 0 && (
                <div className="k-dashed" style={{ background: "#0c0c0c", padding: 32, textAlign: "center" }}>
                    <p style={{ color: "#555", fontSize: 13, fontFamily: "JetBrains Mono, monospace" }}>
                        No members found. The DAO realm may not be deployed yet.
                    </p>
                </div>
            )}

            <ErrorToast message={error} onDismiss={() => setError(null)} />
        </div>
    )
}

// ── Helpers ────────────────────────────────────────────────

function roleColor(role: string): { bg: string; text: string } {
    switch (role.toLowerCase()) {
        case "admin": return { bg: "rgba(0,212,170,0.1)", text: "#00d4aa" }
        case "dev": return { bg: "rgba(33,150,243,0.1)", text: "#2196f3" }
        case "moderator": return { bg: "rgba(156,39,176,0.1)", text: "#9c27b0" }
        default: return { bg: "rgba(255,255,255,0.04)", text: "#888" }
    }
}
