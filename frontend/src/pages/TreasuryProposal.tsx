import { useState } from "react"
import { useNavigate, useOutletContext } from "react-router-dom"
import { ErrorToast } from "../components/ui/ErrorToast"
import { DAO_REALM_PATH } from "../lib/config"
import { buildProposeMsg } from "../lib/dao"
import { doContractBroadcast } from "../lib/grc20"
import type { LayoutContext } from "../types/layout"

export function TreasuryProposal() {
    const navigate = useNavigate()
    const { auth, adena } = useOutletContext<LayoutContext>()

    const [recipient, setRecipient] = useState("")
    const [amount, setAmount] = useState("")
    const [tokenSymbol, setTokenSymbol] = useState("")
    const [memo, setMemo] = useState("")
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [success, setSuccess] = useState<string | null>(null)

    const handlePropose = async () => {
        if (!auth.isAuthenticated || !adena.address) {
            setError("Connect your wallet first")
            return
        }

        const trimRecipient = recipient.trim()
        const trimAmount = amount.trim()
        const trimSymbol = tokenSymbol.trim().toUpperCase()

        if (!trimRecipient) { setError("Recipient address is required"); return }
        if (!/^g(no)?1[a-z0-9]{38,}$/.test(trimRecipient)) { setError("Invalid recipient address"); return }
        if (!trimAmount || isNaN(Number(trimAmount)) || Number(trimAmount) <= 0) { setError("Amount must be greater than 0"); return }

        setLoading(true)
        setError(null)
        setSuccess(null)

        try {
            // Create a DAO proposal for the treasury spend
            const title = `Treasury: Send ${trimAmount} ${trimSymbol || "GNOT"} to ${trimRecipient.slice(0, 10)}...`
            const description = [
                `**Type**: Treasury Spend`,
                `**Recipient**: ${trimRecipient}`,
                `**Amount**: ${trimAmount} ${trimSymbol || "GNOT"}`,
                memo ? `**Memo**: ${memo.trim()}` : "",
            ].filter(Boolean).join("\n")

            const msg = buildProposeMsg(adena.address, DAO_REALM_PATH, title, description)
            await doContractBroadcast([msg], `Propose treasury spend: ${trimAmount} ${trimSymbol || "GNOT"}`)
            setSuccess("Treasury proposal created! Requires DAO vote to execute.")
            setTimeout(() => navigate("/dao"), 2000)
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to create proposal")
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="animate-fade-in" style={{ display: "flex", flexDirection: "column", gap: 28 }}>
            {/* Nav */}
            <button
                onClick={() => navigate("/dao/treasury")}
                style={{ color: "#00d4aa", fontSize: 13, background: "none", border: "none", cursor: "pointer", fontFamily: "JetBrains Mono, monospace", textAlign: "left" }}
            >
                ← Back to Treasury
            </button>

            {/* Header */}
            <div>
                <h2 style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em" }}>Propose Treasury Spend</h2>
                <p style={{ color: "#666", fontSize: 12, marginTop: 4, fontFamily: "JetBrains Mono, monospace" }}>
                    Submit a proposal for the DAO to approve a treasury transfer
                </p>
            </div>

            {!auth.isAuthenticated && (
                <div className="k-dashed" style={{ background: "#0c0c0c", padding: 32, textAlign: "center" }}>
                    <p style={{ color: "#666", fontSize: 13, fontFamily: "JetBrains Mono, monospace" }}>
                        Connect your wallet to propose a treasury spend
                    </p>
                </div>
            )}

            {success && (
                <div style={{ padding: "12px 16px", background: "rgba(0,212,170,0.08)", borderRadius: 8, border: "1px solid rgba(0,212,170,0.2)", color: "#00d4aa", fontSize: 13, fontFamily: "JetBrains Mono, monospace" }}>
                    ✓ {success}
                </div>
            )}

            {/* Form */}
            <div className="k-card" style={{ display: "flex", flexDirection: "column", gap: 20, padding: 24 }}>
                {/* Recipient */}
                <div>
                    <label style={labelStyle}>Recipient Address</label>
                    <input
                        type="text" value={recipient} onChange={(e) => setRecipient(e.target.value)}
                        placeholder="g1recipient..." disabled={loading}
                        style={inputStyle(loading)}
                    />
                </div>

                {/* Amount */}
                <div>
                    <label style={labelStyle}>Amount</label>
                    <input
                        type="text" value={amount}
                        onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                        placeholder="e.g. 1000" disabled={loading}
                        style={inputStyle(loading)}
                    />
                </div>

                {/* Token */}
                <div>
                    <label style={labelStyle}>Token (GRC20 symbol, leave empty for GNOT)</label>
                    <input
                        type="text" value={tokenSymbol}
                        onChange={(e) => setTokenSymbol(e.target.value.toUpperCase())}
                        placeholder="e.g. SAM (optional)" maxLength={10}
                        disabled={loading} style={inputStyle(loading)}
                    />
                    <p style={hintStyle}>Leave empty for GNOT transfers</p>
                </div>

                {/* Memo */}
                <div>
                    <label style={labelStyle}>Memo (optional)</label>
                    <input
                        type="text" value={memo} onChange={(e) => setMemo(e.target.value)}
                        placeholder="Reason for treasury spend" maxLength={256}
                        disabled={loading} style={inputStyle(loading)}
                    />
                </div>
            </div>

            {/* Info banner */}
            <div style={{
                padding: "14px 18px", borderRadius: 8,
                background: "rgba(33,150,243,0.06)", border: "1px solid rgba(33,150,243,0.15)",
                fontSize: 12, fontFamily: "JetBrains Mono, monospace", color: "#2196f3",
            }}>
                ℹ This creates a DAO proposal. Members must vote to approve the spend.
                After passing, someone must execute the proposal to complete the transfer.
            </div>

            {/* Submit */}
            <div style={{ display: "flex", gap: 12 }}>
                <button
                    className="k-btn-primary"
                    onClick={handlePropose}
                    disabled={loading || !auth.isAuthenticated || !recipient.trim() || !amount.trim()}
                    style={{
                        flex: 1,
                        opacity: (!auth.isAuthenticated || !recipient.trim() || !amount.trim()) ? 0.4 : loading ? 0.6 : 1,
                    }}
                >
                    {loading ? "Proposing..." : "Submit Treasury Proposal"}
                </button>
                <button className="k-btn-secondary" onClick={() => navigate("/dao/treasury")}>
                    Cancel
                </button>
            </div>

            <ErrorToast message={error} onDismiss={() => setError(null)} />
        </div>
    )
}

// ── Styles ────────────────────────────────────────────────

const labelStyle: React.CSSProperties = {
    display: "block", marginBottom: 6, fontSize: 11,
    fontFamily: "JetBrains Mono, monospace", color: "#888",
    textTransform: "uppercase", letterSpacing: "0.05em",
}

const hintStyle: React.CSSProperties = {
    marginTop: 4, fontSize: 11,
    fontFamily: "JetBrains Mono, monospace", color: "#555",
}

function inputStyle(loading: boolean): React.CSSProperties {
    return {
        width: "100%", height: 40, padding: "0 12px", borderRadius: 8,
        background: "#0c0c0c", border: "1px solid #222", color: "#f0f0f0",
        fontFamily: "JetBrains Mono, monospace", fontSize: 13, outline: "none",
        opacity: loading ? 0.5 : 1,
    }
}
