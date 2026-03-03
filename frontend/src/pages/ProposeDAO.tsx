import { useState, useEffect } from "react"
import { useNavigate, useParams, useOutletContext } from "react-router-dom"
import { ErrorToast } from "../components/ui/ErrorToast"
import { buildProposeMsg, getDAOConfig, isGovDAO as checkIsGovDAO } from "../lib/dao"
import { doContractBroadcast } from "../lib/grc20"
import { GNO_RPC_URL } from "../lib/config"
import { decodeSlug } from "../lib/daoSlug"
import type { LayoutContext } from "../types/layout"

export function ProposeDAO() {
    const navigate = useNavigate()
    const { slug } = useParams<{ slug: string }>()
    const { auth, adena } = useOutletContext<LayoutContext>()

    const realmPath = slug ? decodeSlug(slug) : ""

    const [title, setTitle] = useState("")
    const [description, setDescription] = useState("")
    const [category, setCategory] = useState("governance")
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [success, setSuccess] = useState<string | null>(null)
    const [isArchived, setIsArchived] = useState(false)
    const isGovDAO = checkIsGovDAO(realmPath)

    const categories = [
        { value: "governance", label: "🏛️ Governance" },
        { value: "treasury", label: "💰 Treasury" },
        { value: "membership", label: "👥 Membership" },
        { value: "operations", label: "⚙️ Operations" },
    ]

    // Check archive status on mount
    useEffect(() => {
        if (!realmPath) return
        getDAOConfig(GNO_RPC_URL, realmPath).then((cfg) => {
            if (cfg?.isArchived) setIsArchived(true)
        }).catch(() => { /* ignore */ })
    }, [realmPath])

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
            const msg = buildProposeMsg(adena.address, realmPath, trimTitle, trimDesc, isGovDAO ? undefined : category)
            await doContractBroadcast([msg], `Propose: ${trimTitle}`)
            setSuccess("Proposal created!")
            setTimeout(() => navigate(`/dao/${slug}`), 2000)
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
                id="propose-back-btn"
                aria-label="Back to DAO"
                onClick={() => navigate(`/dao/${slug}`)}
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

            {/* Archive warning */}
            {isArchived && (
                <div style={{
                    padding: "12px 18px", borderRadius: 10,
                    background: "rgba(245,166,35,0.05)",
                    border: "1px solid rgba(245,166,35,0.15)",
                    display: "flex", alignItems: "center", gap: 10,
                }}>
                    <span style={{ fontSize: 16 }}>📦</span>
                    <div style={{ fontSize: 12, color: "#f5a623", fontFamily: "JetBrains Mono, monospace" }}>
                        This DAO is archived — new proposals cannot be created
                    </div>
                </div>
            )}

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

                {/* Category — not supported by GovDAO */}
                {!isGovDAO && (
                    <div>
                        <label style={labelStyle}>Category</label>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                            {categories.map(c => (
                                <button
                                    key={c.value}
                                    type="button"
                                    onClick={() => setCategory(c.value)}
                                    disabled={loading}
                                    style={{
                                        padding: "6px 14px", borderRadius: 6, fontSize: 12,
                                        fontFamily: "JetBrains Mono, monospace",
                                        border: "1px solid",
                                        borderColor: category === c.value ? "rgba(0,212,170,0.3)" : "#222",
                                        background: category === c.value ? "rgba(0,212,170,0.08)" : "#0c0c0c",
                                        color: category === c.value ? "#00d4aa" : "#888",
                                        cursor: loading ? "default" : "pointer",
                                        transition: "all 0.15s",
                                    }}
                                >
                                    {c.label}
                                </button>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            {/* Summary */}
            <div className="k-card" style={{ padding: 18, display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, fontFamily: "JetBrains Mono, monospace" }}>
                    <span style={{ color: "#666" }}>Realm</span>
                    <span style={{ color: "#aaa" }}>{realmPath}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, fontFamily: "JetBrains Mono, monospace" }}>
                    <span style={{ color: "#666" }}>Function</span>
                    <span style={{ color: "#aaa" }}>Propose(title, description{isGovDAO ? "" : ", category"})</span>
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
                    disabled={loading || !auth.isAuthenticated || !title.trim() || isArchived}
                    style={{
                        flex: 1,
                        opacity: (!auth.isAuthenticated || !title.trim() || isArchived) ? 0.4 : loading ? 0.6 : 1,
                    }}
                >
                    {loading ? "Proposing..." : "Submit Proposal"}
                </button>
                <button className="k-btn-secondary" onClick={() => navigate(`/dao/${slug}`)}>
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
