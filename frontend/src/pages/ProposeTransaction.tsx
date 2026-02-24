import { useState } from "react"
import { useNavigate, useParams } from "react-router-dom"

export function ProposeTransaction() {
    const { address } = useParams<{ address: string }>()
    const navigate = useNavigate()
    const [recipient, setRecipient] = useState("")
    const [amount, setAmount] = useState("")
    const [memo, setMemo] = useState("")

    const handlePropose = async () => {
        if (!recipient || !amount) return
        // TODO(v0.3.0): Build MsgSend, call CreateTransaction (needs auth token)
        console.warn("ProposeTransaction: requires full auth flow (v0.3.0)")
    }

    return (
        <div className="animate-fade-in" style={{ display: "flex", flexDirection: "column", gap: 32 }}>
            <div>
                <button onClick={() => navigate(`/multisig/${address}`)} style={{ color: "#00d4aa", fontSize: 13, background: "none", border: "none", cursor: "pointer", marginBottom: 16, fontFamily: "JetBrains Mono, monospace" }}>
                    ← Back to Multisig
                </button>
                <h2 style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em" }}>Propose Transaction</h2>
                <p style={{ color: "#666", fontSize: 12, marginTop: 4, fontFamily: "JetBrains Mono, monospace", wordBreak: "break-all" }}>
                    From: {address}
                </p>
            </div>

            <div className="k-card" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <div>
                    <label className="k-label" style={{ display: "block", marginBottom: 8 }}>Recipient Address</label>
                    <input
                        type="text"
                        value={recipient}
                        onChange={(e) => setRecipient(e.target.value)}
                        placeholder="g1recipient..."
                        style={{
                            width: "100%", height: 40, padding: "0 12px", borderRadius: 8,
                            background: "#0c0c0c", border: "1px solid #222", color: "#f0f0f0",
                            fontFamily: "JetBrains Mono, monospace", fontSize: 13, outline: "none",
                        }}
                    />
                </div>
                <div>
                    <label className="k-label" style={{ display: "block", marginBottom: 8 }}>Amount (GNOT)</label>
                    <input
                        type="number"
                        step="0.000001"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        placeholder="0.0"
                        style={{
                            width: "100%", height: 40, padding: "0 12px", borderRadius: 8,
                            background: "#0c0c0c", border: "1px solid #222", color: "#f0f0f0",
                            fontFamily: "JetBrains Mono, monospace", fontSize: 13, outline: "none",
                        }}
                    />
                </div>
                <div>
                    <label className="k-label" style={{ display: "block", marginBottom: 8 }}>Memo (optional)</label>
                    <input
                        type="text"
                        value={memo}
                        onChange={(e) => setMemo(e.target.value)}
                        placeholder="Payment for..."
                        style={{
                            width: "100%", height: 40, padding: "0 12px", borderRadius: 8,
                            background: "#0c0c0c", border: "1px solid #222", color: "#f0f0f0",
                            fontFamily: "JetBrains Mono, monospace", fontSize: 13, outline: "none",
                        }}
                    />
                </div>
            </div>

            <div style={{ display: "flex", gap: 12 }}>
                <button
                    className="k-btn-primary"
                    onClick={handlePropose}
                    style={{ opacity: recipient && amount ? 1 : 0.5 }}
                >
                    Submit Proposal
                </button>
                <button className="k-btn-secondary" onClick={() => navigate(`/multisig/${address}`)}>
                    Cancel
                </button>
            </div>
        </div>
    )
}
