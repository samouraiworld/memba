import { useState, useEffect } from "react"
import { useOutletContext } from "react-router-dom"
import { useNetworkNav } from "../hooks/useNetworkNav"
import { NotePencil, UsersThree, Vault, GearSix, Archive, FileText } from "@phosphor-icons/react"
import { ErrorToast } from "../components/ui/ErrorToast"
import { buildProposeMsg, buildProposeAddMemberMsg, getDAOConfig, isGovDAO as checkIsGovDAO } from "../lib/dao"
import { doContractBroadcast } from "../lib/grc20"
import { GNO_RPC_URL } from "../lib/config"
import { useDaoRoute } from "../hooks/useDaoRoute"
import type { LayoutContext } from "../types/layout"

// ── Proposal Templates ───────────────────────────────────────

type ProposalTemplate = "none" | "treasury" | "add-member" | "general"

const PROPOSAL_TEMPLATES: { id: ProposalTemplate; label: string; icon: typeof FileText }[] = [
    { id: "none", label: "Blank", icon: FileText },
    { id: "treasury", label: "Treasury Transfer", icon: Vault },
    { id: "add-member", label: "Add Member", icon: UsersThree },
    { id: "general", label: "General Governance", icon: GearSix },
]

function applyTemplate(template: ProposalTemplate): { title: string; description: string } {
    switch (template) {
        case "treasury":
            return {
                title: "Treasury Transfer Request",
                description: [
                    "## Treasury Transfer Request",
                    "",
                    "**Recipient Address:** g1...",
                    "**Amount:** ___ GNOT",
                    "",
                    "### Justification",
                    "",
                    "_Explain why this transfer is needed and how the funds will be used._",
                ].join("\n"),
            }
        case "add-member":
            return {
                title: "Membership Proposal",
                description: [
                    "## Membership Proposal",
                    "",
                    "**Candidate Address:** g1...",
                    "**Proposed Role:** member",
                    "",
                    "### Reason",
                    "",
                    "_Describe the candidate's background and why they should be added._",
                ].join("\n"),
            }
        case "general":
            return {
                title: "",
                description: [
                    "## Proposal Summary",
                    "",
                    "_Briefly describe what this proposal aims to achieve._",
                    "",
                    "## Details",
                    "",
                    "_Provide full context, rationale, and any relevant links._",
                    "",
                    "## Expected Outcome",
                    "",
                    "_What changes if this proposal passes?_",
                ].join("\n"),
            }
        default:
            return { title: "", description: "" }
    }
}

export function ProposeDAO() {
    const navigate = useNetworkNav()
    const { realmPath, encodedSlug } = useDaoRoute()
    const { auth, adena } = useOutletContext<LayoutContext>()

    const [selectedTemplate, setSelectedTemplate] = useState<ProposalTemplate>("none")
    const [title, setTitle] = useState("")
    const [description, setDescription] = useState("")
    const [category, setCategory] = useState("governance")
    const [proposalType, setProposalType] = useState<"text" | "member">("text")
    const [memberAddress, setMemberAddress] = useState("")
    const [memberRoles, setMemberRoles] = useState<string[]>(["member"])
    const [memberPower] = useState(1)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [success, setSuccess] = useState<string | null>(null)
    const [isArchived, setIsArchived] = useState(false)
    const isGovDAO = checkIsGovDAO(realmPath)

    const categories = [
        { value: "governance", label: "Governance" },
        { value: "treasury", label: "Treasury" },
        { value: "membership", label: "Membership" },
        { value: "operations", label: "Operations" },
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

        let finalTitle = title.trim()
        let finalDesc = description.trim()
        let finalCategory = isGovDAO ? undefined : category

        // Member proposal — auto-generate title/description if needed
        if (proposalType === "member") {
            const trimAddr = memberAddress.trim()
            if (!trimAddr) { setError("Target member address is required"); return }
            if (!/^g1[a-z0-9]{38}$/.test(trimAddr)) { setError("Invalid address (must be g1... format, 40 characters)"); return }
            if (memberRoles.length === 0) { setError("Select at least one role"); return }

            const rolesStr = memberRoles.join(", ")
            if (!finalTitle) {
                finalTitle = `Add member ${trimAddr.slice(0, 10)}... with roles: ${rolesStr}`
            }
            finalDesc = [
                `**Type**: Add Member`,
                `**Address**: ${trimAddr}`,
                `**Roles**: ${rolesStr}`,
                finalDesc ? `**Details**: ${finalDesc}` : "",
            ].filter(Boolean).join("\n")
            finalCategory = "membership"
        } else {
            if (!finalTitle) { setError("Title is required"); return }
        }

        if (finalTitle.length > 128) { setError("Title must be 128 characters or less"); return }
        if (finalDesc.length > 4096) { setError("Description must be 4096 characters or less"); return }

        setLoading(true)
        setError(null)
        setSuccess(null)

        try {
            let msg
            if (proposalType === "member") {
                // Use executable ProposeAddMember — creates governance proposal with embedded action
                const trimAddr = memberAddress.trim()
                msg = buildProposeAddMemberMsg(adena.address, realmPath, trimAddr, memberPower, memberRoles.join(","))
            } else {
                msg = buildProposeMsg(adena.address, realmPath, finalTitle, finalDesc, finalCategory)
            }
            await doContractBroadcast([msg], `Propose: ${finalTitle}`)
            setSuccess("Proposal created!")
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
                onClick={() => navigate(`/dao/${encodedSlug}`)}
                style={{ color: "var(--color-primary)", fontSize: 13, background: "none", border: "none", cursor: "pointer", fontFamily: "JetBrains Mono, monospace", textAlign: "left" }}
            >
                ← Back to DAO
            </button>

            {/* Header */}
            <div>
                <h2 style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em" }}>New Proposal</h2>
                <p style={{ color: "var(--color-text-secondary)", fontSize: 12, marginTop: 4, fontFamily: "JetBrains Mono, monospace" }}>
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
                    <span style={{ fontSize: 16, display: 'flex' }}><Archive size={16} /></span>
                    <div style={{ fontSize: 12, color: "var(--color-warning)", fontFamily: "JetBrains Mono, monospace" }}>
                        This DAO is archived — new proposals cannot be created
                    </div>
                </div>
            )}

            {!auth.isAuthenticated && (
                <div className="k-dashed" style={{ background: "#0c0c0c", padding: 32, textAlign: "center" }}>
                    <p style={{ color: "var(--color-text-secondary)", fontSize: 13, fontFamily: "JetBrains Mono, monospace" }}>
                        Connect your wallet to create a proposal
                    </p>
                </div>
            )}

            {success && (
                <div style={{ padding: "12px 16px", background: "rgba(0,212,170,0.08)", borderRadius: 8, border: "1px solid rgba(0,212,170,0.2)", color: "var(--color-primary)", fontSize: 13, fontFamily: "JetBrains Mono, monospace", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                    <span>✓ {success}</span>
                    <button
                        onClick={() => navigate(`/dao/${encodedSlug}`)}
                        style={{ background: "rgba(0,212,170,0.12)", border: "1px solid rgba(0,212,170,0.3)", borderRadius: 6, padding: "6px 14px", color: "#00d4aa", fontSize: 12, fontFamily: "JetBrains Mono, monospace", cursor: "pointer", whiteSpace: "nowrap" }}
                    >
                        Go to DAO →
                    </button>
                </div>
            )}

            {/* Form */}
            <div className="k-card" style={{ display: "flex", flexDirection: "column", gap: 20, padding: 24 }}>
                {/* Template Selector */}
                <div>
                    <label style={labelStyle}>Template</label>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        {PROPOSAL_TEMPLATES.map(t => (
                            <button
                                key={t.id}
                                type="button"
                                disabled={loading}
                                onClick={() => {
                                    // Warn before overwriting user's custom input
                                    if ((title.trim() || description.trim()) && selectedTemplate !== t.id) {
                                        if (!confirm("This will replace your current title and description. Continue?")) return
                                    }
                                    setSelectedTemplate(t.id)
                                    const { title: tTitle, description: tDesc } = applyTemplate(t.id)
                                    setTitle(tTitle)
                                    setDescription(tDesc)
                                }}
                                style={{
                                    padding: "6px 14px", borderRadius: 6, fontSize: 12,
                                    fontFamily: "JetBrains Mono, monospace",
                                    border: "1px solid",
                                    borderColor: selectedTemplate === t.id ? "rgba(0,212,170,0.3)" : "#222",
                                    background: selectedTemplate === t.id ? "rgba(0,212,170,0.08)" : "#0c0c0c",
                                    color: selectedTemplate === t.id ? "#00d4aa" : "#888",
                                    cursor: loading ? "default" : "pointer",
                                    transition: "all 0.15s",
                                }}
                            >
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><t.icon size={14} /> {t.label}</span>
                            </button>
                        ))}
                    </div>
                    <p style={hintStyle}>Pre-fill title and description with a structured template</p>
                </div>

                {/* Proposal Type Selector */}
                <div>
                    <label style={labelStyle}>Proposal Type</label>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        {[
                            { id: "text" as const, label: "Text / Sentiment", icon: NotePencil, enabled: true },
                            { id: "member" as const, label: "Add Member", icon: UsersThree, enabled: true },
                            { id: "spend" as const, label: "Treasury Spend", icon: Vault, enabled: false, hint: "Use Treasury → New Proposal" },
                            { id: "upgrade" as const, label: "Code Upgrade", icon: GearSix, enabled: false, hint: "Coming in v2.x" },
                        ].map(t => (
                            <button
                                key={t.id}
                                type="button"
                                disabled={!t.enabled || loading}
                                title={t.enabled ? undefined : t.hint}
                                onClick={() => t.enabled && (t.id === "text" || t.id === "member") && setProposalType(t.id)}
                                style={{
                                    padding: "6px 14px", borderRadius: 6, fontSize: 12,
                                    fontFamily: "JetBrains Mono, monospace",
                                    border: "1px solid",
                                    borderColor: t.enabled && proposalType === t.id ? "rgba(0,212,170,0.3)" : t.enabled ? "#222" : "#1a1a1a",
                                    background: t.enabled && proposalType === t.id ? "rgba(0,212,170,0.08)" : t.enabled ? "#0c0c0c" : "#0a0a0a",
                                    color: t.enabled && proposalType === t.id ? "#00d4aa" : t.enabled ? "#888" : "#444",
                                    cursor: t.enabled ? "pointer" : "not-allowed",
                                    opacity: t.enabled ? 1 : 0.5,
                                    transition: "all 0.15s",
                                }}
                            >
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><t.icon size={14} /> {t.label}</span>
                            </button>
                        ))}
                    </div>
                </div>

                {/* Member-specific fields */}
                {proposalType === "member" && (
                    <>
                        <div>
                            <label style={labelStyle}>Target Address</label>
                            <input
                                id="member-address-input"
                                type="text" value={memberAddress}
                                onChange={(e) => setMemberAddress(e.target.value)}
                                placeholder="g1..." maxLength={42}
                                style={inputStyle(loading)} disabled={loading}
                            />
                            <p style={hintStyle}>The address of the member to add</p>
                        </div>
                        <div>
                            <label style={labelStyle}>Roles</label>
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                                {["admin", "dev", "finance", "ops", "member"].map(role => (
                                    <button
                                        key={role}
                                        type="button"
                                        onClick={() => setMemberRoles(prev =>
                                            prev.includes(role) ? prev.filter(r => r !== role) : [...prev, role]
                                        )}
                                        disabled={loading}
                                        style={{
                                            padding: "4px 12px", borderRadius: 6, fontSize: 11,
                                            fontFamily: "JetBrains Mono, monospace",
                                            border: "1px solid",
                                            borderColor: memberRoles.includes(role) ? "rgba(0,212,170,0.3)" : "#222",
                                            background: memberRoles.includes(role) ? "rgba(0,212,170,0.08)" : "#0c0c0c",
                                            color: memberRoles.includes(role) ? "#00d4aa" : "#666",
                                            cursor: loading ? "default" : "pointer",
                                            transition: "all 0.15s",
                                        }}
                                    >
                                        {role}
                                    </button>
                                ))}
                            </div>
                            <p style={hintStyle}>Selected: {memberRoles.join(", ") || "none"}</p>
                        </div>
                    </>
                )}

                <div>
                    <label style={labelStyle}>{proposalType === "member" ? "Title (optional)" : "Title"}</label>
                    <input
                        type="text" value={title} onChange={(e) => setTitle(e.target.value)}
                        placeholder={proposalType === "member" ? "Auto-generated if empty" : "e.g. Add new member to DAO"}
                        maxLength={128}
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
                    <span style={{ color: "var(--color-text-secondary)" }}>Realm</span>
                    <span style={{ color: "var(--color-text-secondary)" }}>{realmPath}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, fontFamily: "JetBrains Mono, monospace" }}>
                    <span style={{ color: "var(--color-text-secondary)" }}>Function</span>
                    <span style={{ color: "var(--color-text-secondary)" }}>Propose(title, description{isGovDAO ? "" : ", category"})</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, fontFamily: "JetBrains Mono, monospace" }}>
                    <span style={{ color: "var(--color-text-secondary)" }}>Proposer</span>
                    <span style={{ color: "var(--color-text-secondary)" }}>{adena.address || "—"}</span>
                </div>
            </div>

            {/* Source Code Preview */}
            {auth.isAuthenticated && title.trim() && (
                <details style={{ fontSize: 11, fontFamily: "JetBrains Mono, monospace" }}>
                    <summary style={{ cursor: "pointer", color: "var(--color-text-muted)", userSelect: "none" }}>
                        📋 View Source Code (MsgCall)
                    </summary>
                    <pre style={{
                        marginTop: 8, fontSize: 10, color: "var(--color-text-secondary)", overflow: "auto",
                        background: "#0c0c0c", padding: 12, borderRadius: 8,
                        border: "1px solid #1a1a1a", maxHeight: 200,
                    }}>
                        {JSON.stringify(
                            buildProposeMsg(adena.address || "", realmPath, title.trim(), description.trim(), isGovDAO ? undefined : category),
                            null, 2,
                        )}
                    </pre>
                </details>
            )}

            {/* Submit */}
            <div style={{ display: "flex", gap: 12 }}>
                <button
                    className="k-btn-primary"
                    onClick={handlePropose}
                    disabled={loading || !auth.isAuthenticated || (proposalType === "text" && !title.trim()) || isArchived}
                    style={{
                        flex: 1,
                        opacity: (!auth.isAuthenticated || (proposalType === "text" && !title.trim()) || isArchived) ? 0.4 : loading ? 0.6 : 1,
                    }}
                >
                    {loading ? "Proposing..." : "Submit Proposal"}
                </button>
                <button className="k-btn-secondary" onClick={() => navigate(`/dao/${encodedSlug}`)}>
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
    fontFamily: "JetBrains Mono, monospace", color: "var(--color-text-secondary)",
    textTransform: "uppercase", letterSpacing: "0.05em",
}

const hintStyle: React.CSSProperties = {
    marginTop: 4, fontSize: 11,
    fontFamily: "JetBrains Mono, monospace", color: "var(--color-text-muted)",
}

function inputStyle(loading: boolean): React.CSSProperties {
    return {
        width: "100%", height: 40, padding: "0 12px", borderRadius: 8,
        background: "#0c0c0c", border: "1px solid #222", color: "var(--color-text)",
        fontFamily: "JetBrains Mono, monospace", fontSize: 13, outline: "none",
        opacity: loading ? 0.5 : 1,
    }
}
