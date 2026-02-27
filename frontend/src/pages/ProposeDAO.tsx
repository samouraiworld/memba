import { useState } from "react"
import { useNavigate, useOutletContext } from "react-router-dom"
import { ErrorToast } from "../components/ui/ErrorToast"
import { DAO_REALM_PATH } from "../lib/config"
import { buildProposeMsg } from "../lib/dao"
import { doContractBroadcast } from "../lib/grc20"
import type { LayoutContext } from "../types/layout"

export function ProposeDAO() {
    const navigate = useNavigate()
    const { auth, adena } = useOutletContext<LayoutContext>()

    const [title, setTitle] = useState("")
    const [description, setDescription] = useState("")
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [success, setSuccess] = useState<string | null>(null)

    const handlePropose = async () => {
        if (!auth.isAuthenticated || !adena.address) {
            setError("Connect your wallet first")
            return
        }

        const trimTitle = title.trim()
        const trimDesc = description.trim()
        if (!trimTitle) { setError("Title is required"); return }
        if (trimTitle.length > 128) { setError("Title must be 128 characters or less"); return }
        if (trimDesc.length > 4096) { setError("Description must be 4096 characters or less"); return }

        setLoading(true)
        setError(null)
        setSuccess(null)

        try {
            const msg = buildProposeMsg(adena.address, DAO_REALM_PATH, trimTitle, trimDesc)
            await doContractBroadcast([msg], `Propose: ${trimTitle}`)
            setSuccess("Proposal created!")
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
                onClick={() => navigate("/dao")}
                style={{ color: "#00d4aa", fontSize: 13, background: "none", border: "none", cursor: "pointer", fontFamily: "JetBrains Mono, monospace", textAlign: "left" }}
            >
                ← Back to DAO
            </button>

            {/* Header */}
            <div>
                <h2 style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em" }}>New Proposal</h2>
                <p style={{ color: "#666", fontSize: 12, marginTop: 4, fontFamily: "JetBrains Mono, monospace" }}>
                    Submit a proposal for the DAO to vote on
                </p>
            </div>

            {!auth.isAuthenticated && (
                <div className="k-dashed" style={{ background: "#0c0c0c", padding: 32, textAlign: "center" }}>
                    <p style={{ color: "#666", fontSize: 13, fontFamily: "JetBrains Mono, monospace" }}>
                        Connect your wallet to create a proposal
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
                <div>
                    <label style={labelStyle}>Title</label>
                    <input
                        type="text" value={title} onChange={(e) => setTitle(e.target.value)}
                        placeholder="e.g. Add new member to DAO" maxLength={128}
                        style={inputStyle(loading)} disabled={loading}
                    />
                    <p style={hintStyle}>{title.length}/128 characters</p>
                </div>

                <div>
                    <label style={labelStyle}>Description (optional)</label>
                    <textarea
                        value={description} onChange={(e) => setDescription(e.target.value)}
                        placeholder="Describe the proposal in detail..."
                        maxLength={4096} rows={6}
                        style={{
                            ...inputStyle(loading),
                            height: "auto",
                            padding: "12px",
                            resize: "vertical",
                            minHeight: 120,
                        }}
                        disabled={loading}
                    />
                    <p style={hintStyle}>{description.length}/4096 characters</p>
                </div>
            </div>

            {/* Summary */}
            <div className="k-card" style={{ padding: 18, display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, fontFamily: "JetBrains Mono, monospace" }}>
                    <span style={{ color: "#666" }}>Realm</span>
                    <span style={{ color: "#aaa" }}>{DAO_REALM_PATH}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, fontFamily: "JetBrains Mono, monospace" }}>
                    <span style={{ color: "#666" }}>Function</span>
                    <span style={{ color: "#aaa" }}>Propose(title, description)</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, fontFamily: "JetBrains Mono, monospace" }}>
                    <span style={{ color: "#666" }}>Proposer</span>
                    <span style={{ color: "#aaa" }}>{adena.address || "—"}</span>
                </div>
            </div>

            {/* Submit */}
            <div style={{ display: "flex", gap: 12 }}>
                <button
                    className="k-btn-primary"
                    onClick={handlePropose}
                    disabled={loading || !auth.isAuthenticated || !title.trim()}
                    style={{
                        flex: 1,
                        opacity: (!auth.isAuthenticated || !title.trim()) ? 0.4 : loading ? 0.6 : 1,
                    }}
                >
                    {loading ? "Proposing..." : "Submit Proposal"}
                </button>
                <button className="k-btn-secondary" onClick={() => navigate("/dao")}>
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
