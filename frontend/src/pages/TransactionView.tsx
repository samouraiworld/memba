import { useNavigate, useParams } from "react-router-dom"
import { ProgressBar } from "../components/multisig/ProgressBar"

export function TransactionView() {
    const { id } = useParams<{ id: string }>()
    const navigate = useNavigate()

    // TODO: fetch real tx data via API (needs auth token)
    const mockTx = {
        id: id || "0",
        type: "send",
        recipient: "g1example...",
        amount: "1.0 GNOT",
        memo: "",
        creator: "g1creator...",
        signatures: 0,
        threshold: 2,
        membersCount: 3,
        signers: [] as { address: string; signed: boolean }[],
        executed: false,
        finalHash: "",
    }

    return (
        <div className="animate-fade-in" style={{ display: "flex", flexDirection: "column", gap: 32 }}>
            <div>
                <button onClick={() => navigate(-1)} style={{ color: "#00d4aa", fontSize: 13, background: "none", border: "none", cursor: "pointer", marginBottom: 16, fontFamily: "JetBrains Mono, monospace" }}>
                    ← Back
                </button>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 16 }}>
                    <div>
                        <h2 style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em" }}>Transaction #{mockTx.id}</h2>
                        <p style={{ color: "#666", fontSize: 12, marginTop: 4, fontFamily: "JetBrains Mono, monospace" }}>
                            {mockTx.type.toUpperCase()} • Created by {mockTx.creator}
                        </p>
                    </div>
                    {!mockTx.executed && (
                        <span className="k-label" style={{
                            padding: "4px 10px", borderRadius: 6,
                            background: "rgba(255, 165, 2, 0.08)", color: "#ffa502",
                            border: "1px solid rgba(255, 165, 2, 0.2)",
                        }}>
                            Pending
                        </span>
                    )}
                    {mockTx.executed && (
                        <span className="k-label" style={{
                            padding: "4px 10px", borderRadius: 6,
                            background: "rgba(0, 212, 170, 0.08)", color: "#00d4aa",
                            border: "1px solid rgba(0, 212, 170, 0.2)",
                        }}>
                            Executed
                        </span>
                    )}
                </div>
            </div>

            {/* Details */}
            <div className="k-card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span className="k-label">Recipient</span>
                    <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 13, color: "#ccc" }}>{mockTx.recipient}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span className="k-label">Amount</span>
                    <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 13, color: "#00d4aa", fontWeight: 600 }}>{mockTx.amount}</span>
                </div>
                {mockTx.memo && (
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span className="k-label">Memo</span>
                        <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 13, color: "#ccc" }}>{mockTx.memo}</span>
                    </div>
                )}
            </div>

            {/* Progress */}
            <div>
                <h3 style={{ fontSize: 16, fontWeight: 500, marginBottom: 16 }}>Signature Progress</h3>
                <ProgressBar
                    current={mockTx.signatures}
                    threshold={mockTx.threshold}
                    total={mockTx.membersCount}
                />
            </div>

            {/* Signers */}
            <div>
                <h3 style={{ fontSize: 16, fontWeight: 500, marginBottom: 16 }}>Signers</h3>
                <div className="k-card" style={{ padding: 0, overflow: "hidden" }}>
                    <div style={{
                        padding: "12px 20px", borderBottom: "1px solid #222",
                        display: "grid", gridTemplateColumns: "1fr auto",
                        fontSize: 11, fontFamily: "JetBrains Mono, monospace", color: "#555",
                        textTransform: "uppercase", letterSpacing: "0.05em",
                    }}>
                        <span>Member</span>
                        <span>Status</span>
                    </div>
                    {mockTx.signers.length === 0 ? (
                        <div style={{ padding: 32, textAlign: "center" }}>
                            <p style={{ color: "#555", fontSize: 14, fontFamily: "JetBrains Mono, monospace" }}>
                                Connect wallet to view signers
                            </p>
                        </div>
                    ) : (
                        mockTx.signers.map((s, i) => (
                            <div key={i} style={{
                                padding: "12px 20px", borderBottom: "1px solid #111",
                                display: "grid", gridTemplateColumns: "1fr auto", alignItems: "center",
                            }}>
                                <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 12, color: "#ccc" }}>
                                    {s.address}
                                </span>
                                <span style={{
                                    fontSize: 11, padding: "2px 8px", borderRadius: 4,
                                    background: s.signed ? "rgba(0,212,170,0.08)" : "rgba(255,255,255,0.04)",
                                    color: s.signed ? "#00d4aa" : "#555",
                                    fontFamily: "JetBrains Mono, monospace",
                                }}>
                                    {s.signed ? "Signed" : "Pending"}
                                </span>
                            </div>
                        ))
                    )}
                </div>
            </div>

            {/* Actions */}
            {!mockTx.executed && (
                <div style={{ display: "flex", gap: 12 }}>
                    <button className="k-btn-primary">
                        Sign Transaction
                    </button>
                    {mockTx.signatures >= mockTx.threshold && (
                        <button className="k-btn-primary" style={{ background: "#00e6bb" }}>
                            Broadcast to Chain
                        </button>
                    )}
                </div>
            )}

            {mockTx.executed && mockTx.finalHash && (
                <div className="k-card" style={{ borderColor: "rgba(0,212,170,0.2)" }}>
                    <p className="k-label" style={{ marginBottom: 8 }}>Transaction Hash</p>
                    <p style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 12, color: "#00d4aa", wordBreak: "break-all" }}>
                        {mockTx.finalHash}
                    </p>
                </div>
            )}
        </div>
    )
}
