import { useNavigate, useParams } from "react-router-dom"

export function MultisigView() {
    const { address } = useParams<{ address: string }>()
    const navigate = useNavigate()

    // TODO: fetch real data via useMultisig + useBalance (Branch 3)

    return (
        <div className="animate-fade-in" style={{ display: "flex", flexDirection: "column", gap: 32 }}>
            {/* Header */}
            <div>
                <button onClick={() => navigate("/")} style={{ color: "#00d4aa", fontSize: 13, background: "none", border: "none", cursor: "pointer", marginBottom: 16, fontFamily: "JetBrains Mono, monospace" }}>
                    ← Back to Dashboard
                </button>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 16 }}>
                    <div>
                        <h2 style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em" }}>Multisig Wallet</h2>
                        <p style={{ color: "#666", fontSize: 12, marginTop: 4, fontFamily: "JetBrains Mono, monospace", wordBreak: "break-all" }}>
                            {address}
                        </p>
                    </div>
                    <button
                        className="k-btn-primary"
                        onClick={() => navigate(`/multisig/${address}/propose`)}
                    >
                        Propose Transaction
                    </button>
                </div>
            </div>

            {/* Info cards */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16 }}>
                <div className="k-card">
                    <p className="k-label">Threshold</p>
                    <p className="k-value k-value-accent">— / —</p>
                </div>
                <div className="k-card">
                    <p className="k-label">Balance</p>
                    <p className="k-value">— GNOT</p>
                </div>
                <div className="k-card">
                    <p className="k-label">Pending TX</p>
                    <p className="k-value">0</p>
                </div>
            </div>

            {/* Members */}
            <div>
                <h3 style={{ fontSize: 16, fontWeight: 500, marginBottom: 16 }}>Members</h3>
                <div className="k-card" style={{ padding: 0, overflow: "hidden" }}>
                    <div style={{
                        padding: "12px 20px", borderBottom: "1px solid #222",
                        display: "grid", gridTemplateColumns: "1fr auto",
                        fontSize: 11, fontFamily: "JetBrains Mono, monospace", color: "#555",
                        textTransform: "uppercase", letterSpacing: "0.05em",
                    }}>
                        <span>Address</span>
                        <span>Status</span>
                    </div>
                    <div style={{ padding: 32, textAlign: "center" }}>
                        <p style={{ color: "#555", fontSize: 14, fontFamily: "JetBrains Mono, monospace" }}>
                            Connect wallet to view members
                        </p>
                    </div>
                </div>
            </div>

            {/* Pending Transactions */}
            <div>
                <h3 style={{ fontSize: 16, fontWeight: 500, marginBottom: 16 }}>Transactions</h3>
                <div className="k-card" style={{ textAlign: "center", padding: 32 }}>
                    <p style={{ color: "#555", fontSize: 14, fontFamily: "JetBrains Mono, monospace" }}>
                        No transactions yet
                    </p>
                </div>
            </div>
        </div>
    )
}
