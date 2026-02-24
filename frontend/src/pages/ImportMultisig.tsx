import { useState } from "react"
import { useNavigate } from "react-router-dom"

export function ImportMultisig() {
    const navigate = useNavigate()
    const [address, setAddress] = useState("")

    const handleImport = async () => {
        if (!address.trim()) return
        // TODO: call MultisigInfo to verify, then CreateOrJoinMultisig (Branch 3)
        alert("Import requires Adena wallet connection (Branch 3)")
    }

    return (
        <div className="animate-fade-in" style={{ display: "flex", flexDirection: "column", gap: 32 }}>
            <div>
                <button onClick={() => navigate("/")} style={{ color: "#00d4aa", fontSize: 13, background: "none", border: "none", cursor: "pointer", marginBottom: 16, fontFamily: "JetBrains Mono, monospace" }}>
                    ← Back to Dashboard
                </button>
                <h2 style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em" }}>Import Multisig</h2>
                <p style={{ color: "#999", fontSize: 14, marginTop: 4 }}>
                    Import an existing multisig wallet by its on-chain address
                </p>
            </div>

            <div className="k-card" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <label className="k-label">Multisig Address</label>
                <input
                    type="text"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="g1abc123..."
                    style={{
                        width: "100%", height: 44, padding: "0 16px", borderRadius: 8,
                        background: "#0c0c0c", border: "1px solid #222", color: "#f0f0f0",
                        fontFamily: "JetBrains Mono, monospace", fontSize: 14, outline: "none",
                    }}
                />
                <p style={{ color: "#666", fontSize: 12, fontFamily: "JetBrains Mono, monospace" }}>
                    Paste the multisig wallet address from the Gno chain
                </p>
            </div>

            <div style={{ display: "flex", gap: 12 }}>
                <button className="k-btn-primary" onClick={handleImport} style={{ opacity: address.trim() ? 1 : 0.5 }}>
                    Import & Join
                </button>
                <button className="k-btn-secondary" onClick={() => navigate("/")}>
                    Cancel
                </button>
            </div>
        </div>
    )
}
