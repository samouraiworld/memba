import { useState } from "react"
import { useNavigate } from "react-router-dom"

export function CreateMultisig() {
    const navigate = useNavigate()
    const [name, setName] = useState("")
    const [threshold, setThreshold] = useState(2)
    const [members, setMembers] = useState(["", "", ""])

    const addMember = () => setMembers([...members, ""])
    const removeMember = (i: number) => {
        if (members.length <= 2) return
        setMembers(members.filter((_, idx) => idx !== i))
    }
    const updateMember = (i: number, val: string) => {
        const copy = [...members]
        copy[i] = val
        setMembers(copy)
    }

    const handleCreate = async () => {
        // TODO(v0.3.0): Connect to Adena, build multisig pubkey, call CreateOrJoinMultisig
        console.warn("CreateMultisig: requires Adena wallet integration (v0.3.0)")
    }

    return (
        <div className="animate-fade-in" style={{ display: "flex", flexDirection: "column", gap: 32 }}>
            <div>
                <button onClick={() => navigate("/")} style={{ color: "#00d4aa", fontSize: 13, background: "none", border: "none", cursor: "pointer", marginBottom: 16, fontFamily: "JetBrains Mono, monospace" }}>
                    ← Back to Dashboard
                </button>
                <h2 style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em" }}>Create Multisig</h2>
                <p style={{ color: "#999", fontSize: 14, marginTop: 4 }}>
                    Set up a new multisig wallet with your team
                </p>
            </div>

            {/* Name */}
            <div className="k-card">
                <label className="k-label" style={{ display: "block", marginBottom: 8 }}>Wallet Name</label>
                <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. samourai-crew"
                    style={{
                        width: "100%", height: 40, padding: "0 12px", borderRadius: 8,
                        background: "#0c0c0c", border: "1px solid #222", color: "#f0f0f0",
                        fontFamily: "JetBrains Mono, monospace", fontSize: 13, outline: "none",
                    }}
                />
            </div>

            {/* Members */}
            <div className="k-card">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                    <label className="k-label">Members ({members.length})</label>
                    <button onClick={addMember} style={{ color: "#00d4aa", fontSize: 12, background: "none", border: "none", cursor: "pointer", fontFamily: "JetBrains Mono, monospace" }}>
                        + Add Member
                    </button>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {members.map((m, i) => (
                        <div key={i} style={{ display: "flex", gap: 8 }}>
                            <input
                                type="text"
                                value={m}
                                onChange={(e) => updateMember(i, e.target.value)}
                                placeholder={`g1member${i + 1}...`}
                                style={{
                                    flex: 1, height: 36, padding: "0 12px", borderRadius: 6,
                                    background: "#0c0c0c", border: "1px solid #222", color: "#f0f0f0",
                                    fontFamily: "JetBrains Mono, monospace", fontSize: 12, outline: "none",
                                }}
                            />
                            {members.length > 2 && (
                                <button onClick={() => removeMember(i)} style={{ width: 36, height: 36, borderRadius: 6, background: "none", border: "1px solid #222", color: "#666", cursor: "pointer", fontSize: 14 }}>
                                    ×
                                </button>
                            )}
                        </div>
                    ))}
                </div>
            </div>

            {/* Threshold */}
            <div className="k-card">
                <label className="k-label" style={{ display: "block", marginBottom: 8 }}>
                    Threshold — {threshold} of {members.length}
                </label>
                <input
                    type="range"
                    min={1}
                    max={members.length}
                    value={threshold}
                    onChange={(e) => setThreshold(Number(e.target.value))}
                    style={{ width: "100%", accentColor: "#00d4aa" }}
                />
                <p style={{ color: "#666", fontSize: 12, marginTop: 8, fontFamily: "JetBrains Mono, monospace" }}>
                    {threshold} signature{threshold > 1 ? "s" : ""} required to execute a transaction
                </p>
            </div>

            {/* Submit */}
            <div style={{ display: "flex", gap: 12 }}>
                <button className="k-btn-primary" onClick={handleCreate}>
                    Create Multisig
                </button>
                <button className="k-btn-secondary" onClick={() => navigate("/")}>
                    Cancel
                </button>
            </div>
        </div>
    )
}
