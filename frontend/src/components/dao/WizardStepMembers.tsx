import { inputStyle, ROLE_COLORS, ROLE_ICONS, type MemberInput, type Step } from "./wizardShared"

interface Props {
    members: MemberInput[]
    availableRoles: string[]
    walletAddress: string
    validMembers: MemberInput[]
    adminCount: number
    totalPower: number
    onMembersChange: (members: MemberInput[]) => void
    onGoToStep: (s: Step) => void
    onNext: () => void
}

export function WizardStepMembers({
    members, availableRoles, walletAddress,
    validMembers, adminCount, totalPower,
    onMembersChange, onGoToStep, onNext,
}: Props) {
    const addMember = () => onMembersChange([...members, { address: "", power: 1, roles: ["member"] }])

    const removeMember = (i: number) => {
        if (members.length <= 1) return
        onMembersChange(members.filter((_, idx) => idx !== i))
    }

    const updateMember = (i: number, field: "address" | "power", value: string) => {
        const next = [...members]
        if (field === "power") {
            next[i] = { ...next[i], power: Math.max(1, parseInt(value, 10) || 1) }
        } else {
            next[i] = { ...next[i], address: value.trim() }
        }
        onMembersChange(next)
    }

    const toggleMemberRole = (i: number, role: string) => {
        const next = [...members]
        const m = next[i]
        if (m.roles.includes(role)) {
            next[i] = { ...m, roles: m.roles.filter((r) => r !== role) }
        } else {
            next[i] = { ...m, roles: [...m.roles, role] }
        }
        onMembersChange(next)
    }

    return (
        <div className="k-card" style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                <h3 style={{ fontSize: 14, fontWeight: 600, color: "#f0f0f0" }}>Initial Members & Roles</h3>
                <span style={{ fontSize: 11, color: "#666", fontFamily: "JetBrains Mono, monospace" }}>
                    {validMembers.length} member{validMembers.length !== 1 ? "s" : ""} · {adminCount} admin{adminCount !== 1 ? "s" : ""} · power: {totalPower}
                </span>
            </div>

            {members.map((m, i) => (
                <div key={i} style={{ display: "flex", flexDirection: "column", gap: 8, padding: 12, borderRadius: 8, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <input
                            type="text"
                            value={m.address}
                            onChange={(e) => updateMember(i, "address", e.target.value)}
                            placeholder="g1..."
                            style={{ ...inputStyle, flex: 1 }}
                        />
                        <input
                            type="number"
                            value={m.power}
                            onChange={(e) => updateMember(i, "power", e.target.value)}
                            min="1"
                            max="100"
                            style={{ ...inputStyle, width: 70, textAlign: "center" }}
                        />
                        <span style={{ fontSize: 9, color: "#555", fontFamily: "JetBrains Mono, monospace", width: 40 }}>power</span>
                        {members.length > 1 && (
                            <button
                                onClick={() => removeMember(i)}
                                style={{ background: "none", border: "none", cursor: "pointer", color: "#f44", fontSize: 16, padding: 4 }}
                            >
                                ×
                            </button>
                        )}
                    </div>
                    {/* Role toggles */}
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", paddingLeft: 4 }}>
                        {availableRoles.map((role) => {
                            const active = m.roles.includes(role)
                            const color = ROLE_COLORS[role] || "#888"
                            return (
                                <button
                                    key={role}
                                    onClick={() => toggleMemberRole(i, role)}
                                    style={{
                                        fontSize: 10, padding: "3px 8px", borderRadius: 4, cursor: "pointer",
                                        fontFamily: "JetBrains Mono, monospace",
                                        background: active ? `${color}20` : "transparent",
                                        border: `1px solid ${active ? `${color}60` : "rgba(255,255,255,0.08)"}`,
                                        color: active ? color : "#555",
                                        transition: "all 0.15s",
                                    }}
                                >
                                    {ROLE_ICONS[role] || "•"} {role}
                                </button>
                            )
                        })}
                    </div>
                </div>
            ))}

            {walletAddress && !members.some((m) => m.address === walletAddress) && (
                <button
                    className="k-btn-secondary"
                    onClick={() => onMembersChange([{ address: walletAddress, power: 1, roles: ["admin"] }, ...members])}
                    style={{ fontSize: 11, padding: "6px 12px", alignSelf: "flex-start" }}
                >
                    + Add my address (as admin)
                </button>
            )}

            <button
                onClick={addMember}
                style={{
                    background: "none", border: "1px dashed rgba(0,212,170,0.3)", borderRadius: 8,
                    padding: "10px", cursor: "pointer", color: "#00d4aa", fontSize: 12,
                    fontFamily: "JetBrains Mono, monospace",
                }}
            >
                + Add Member
            </button>

            <div style={{ display: "flex", justifyContent: "space-between" }}>
                <button className="k-btn-secondary" onClick={() => onGoToStep(1)} style={{ fontSize: 13, padding: "10px 20px" }}>
                    ← Back
                </button>
                <button className="k-btn-primary" onClick={onNext} style={{ fontSize: 13, padding: "10px 24px" }}>
                    Next: Governance →
                </button>
            </div>
        </div>
    )
}
