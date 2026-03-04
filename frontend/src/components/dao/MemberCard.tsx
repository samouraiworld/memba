/**
 * MemberCard — DAO member summary with tier badge, roles, and profile link.
 *
 * Extracted in v1.5.0 from DAOHome.tsx.
 */
import type { DAOMember } from "../../lib/dao/shared"

export function MemberCard({ member, isCurrentUser, onProfileClick }: { member: DAOMember; isCurrentUser: boolean; onProfileClick: (addr: string) => void }) {
    const truncAddr = member.address.length > 16
        ? `${member.address.slice(0, 8)}...${member.address.slice(-6)}`
        : member.address
    return (
        <div className="k-card" style={{ padding: "14px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                <button
                    onClick={() => onProfileClick(member.address)}
                    title="View profile"
                    style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12, padding: 0, color: "#555", transition: "color 0.15s", flexShrink: 0 }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = "#00d4aa")}
                    onMouseLeave={(e) => (e.currentTarget.style.color = "#555")}
                >
                    👤
                </button>
                {member.username && (
                    <a
                        href={`/u/${member.username.replace("@", "")}`}
                        style={{ fontSize: 11, color: "#00d4aa", fontWeight: 600, fontFamily: "JetBrains Mono, monospace", textDecoration: "none", whiteSpace: "nowrap" }}
                    >
                        {member.username}
                    </a>
                )}
                <span style={{ fontSize: 9, color: "#555", fontFamily: "JetBrains Mono, monospace", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
                    title={member.address}
                >
                    {truncAddr}
                </span>
                {isCurrentUser && (
                    <span style={{
                        padding: "2px 6px", borderRadius: 4, fontSize: 9,
                        fontFamily: "JetBrains Mono, monospace",
                        background: "rgba(0,212,170,0.1)", color: "#00d4aa", flexShrink: 0,
                    }}>
                        YOU
                    </span>
                )}
            </div>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                {member.tier && (
                    <span style={{
                        padding: "2px 8px", borderRadius: 4, fontSize: 10,
                        fontFamily: "JetBrains Mono, monospace", fontWeight: 500, whiteSpace: "nowrap",
                        background: member.tier === "T1" ? "rgba(0,212,170,0.1)" : member.tier === "T2" ? "rgba(33,150,243,0.1)" : "rgba(245,166,35,0.1)",
                        color: member.tier === "T1" ? "#00d4aa" : member.tier === "T2" ? "#2196f3" : "#f5a623",
                    }}>
                        {member.tier}
                    </span>
                )}
                {member.roles.map((role) => {
                    const rc: Record<string, string> = { admin: "#f5a623", dev: "#00d4aa", finance: "#7b61ff", ops: "#3b82f6", member: "#888" }
                    const c = rc[role] || "#888"
                    return (
                        <span key={role} style={{
                            padding: "2px 8px", borderRadius: 4, fontSize: 10,
                            fontFamily: "JetBrains Mono, monospace", fontWeight: 500,
                            whiteSpace: "nowrap",
                            background: `${c}15`, color: c,
                        }}>
                            {role}
                        </span>
                    )
                })}
            </div>
        </div>
    )
}
