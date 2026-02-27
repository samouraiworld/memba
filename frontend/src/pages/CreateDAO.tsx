import { useNavigate } from "react-router-dom"

export function CreateDAO() {
    const navigate = useNavigate()

    return (
        <div className="animate-fade-in" style={{ display: "flex", flexDirection: "column", gap: 28 }}>
            {/* Nav */}
            <button
                id="create-dao-back-btn"
                aria-label="Back to DAO list"
                onClick={() => navigate("/dao")}
                style={{ color: "#00d4aa", fontSize: 13, background: "none", border: "none", cursor: "pointer", fontFamily: "JetBrains Mono, monospace", textAlign: "left" }}
            >
                ← Back to DAOs
            </button>

            {/* Header */}
            <div>
                <h2 style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em" }}>
                    Create a DAO
                </h2>
                <p style={{ color: "#888", fontSize: 12, marginTop: 4, fontFamily: "JetBrains Mono, monospace" }}>
                    Deploy a new governance DAO on gno.land
                </p>
            </div>

            {/* Coming Soon */}
            <div className="k-card" style={{ padding: 48, textAlign: "center" }}>
                <div style={{
                    width: 64, height: 64, borderRadius: 16,
                    background: "rgba(0,212,170,0.06)", border: "1px dashed rgba(0,212,170,0.3)",
                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                    marginBottom: 20,
                }}>
                    <span style={{ fontSize: 32 }}>🏗️</span>
                </div>

                <h3 style={{ fontSize: 18, fontWeight: 600, color: "#f0f0f0", marginBottom: 12 }}>
                    Coming in v5.0.0
                </h3>

                <p style={{
                    color: "#666", fontSize: 13, maxWidth: 480, margin: "0 auto 24px",
                    fontFamily: "JetBrains Mono, monospace", lineHeight: 1.7,
                }}>
                    DAO creation will let you deploy a new governance realm on-chain with custom
                    members, voting thresholds, and treasury management — all from this interface.
                </p>

                <div style={{
                    display: "flex", flexDirection: "column", gap: 12, maxWidth: 360,
                    margin: "0 auto", textAlign: "left",
                }}>
                    <InfoRow icon="👥" label="Custom Members" desc="Add initial members with role assignments" />
                    <InfoRow icon="📊" label="Voting Threshold" desc="Configure quorum and approval requirements" />
                    <InfoRow icon="💰" label="Treasury" desc="Integrated treasury with spending proposals" />
                    <InfoRow icon="⚡" label="Auto-Execute" desc="Passed proposals execute automatically" />
                </div>

                <div style={{ marginTop: 32, display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
                    <button className="k-btn-primary" onClick={() => navigate("/dao")}>
                        Browse Existing DAOs
                    </button>
                    <a
                        href="https://docs.gno.land/concepts/realms/"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="k-btn-secondary"
                        style={{ textDecoration: "none" }}
                    >
                        Learn about Realms →
                    </a>
                </div>
            </div>
        </div>
    )
}

// ── Components ────────────────────────────────────────────

function InfoRow({ icon, label, desc }: { icon: string; label: string; desc: string }) {
    return (
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "8px 12px", borderRadius: 8, background: "rgba(255,255,255,0.02)" }}>
            <span style={{ fontSize: 16, marginTop: 1 }}>{icon}</span>
            <div>
                <div style={{ fontWeight: 600, fontSize: 13, color: "#f0f0f0" }}>{label}</div>
                <div style={{ fontSize: 11, color: "#666", fontFamily: "JetBrains Mono, monospace" }}>{desc}</div>
            </div>
        </div>
    )
}
