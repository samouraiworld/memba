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
import "./proposedao.css"

// ── Proposal Templates ───────────────────────────────────────

type ProposalTemplate = "none" | "treasury" | "add-member" | "general"

const PROPOSAL_TEMPLATES: { id: ProposalTemplate; label: string; icon: typeof FileText }[] = [
    { id: "none", label: "Blank", icon: FileText },
    { id: "treasury", label: "Treasury Transfer", icon: Vault },
    { id: "add-member", label: "Membership", icon: UsersThree },
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
        <div className="animate-fade-in pdao-page">
            {/* Nav */}
            <button
                id="propose-back-btn"
                className="pdao-back-btn"
                aria-label="Back to DAO"
                onClick={() => navigate(`/dao/${encodedSlug}`)}
            >
                ← Back to DAO
            </button>

            {/* Header */}
            <div>
                <h2 className="pdao-header-title">New Proposal</h2>
                <p className="pdao-header-subtitle">
                    Submit a proposal for the DAO to vote on
                </p>
            </div>

            {/* Archive warning */}
            {isArchived && (
                <div className="pdao-archive-banner">
                    <span className="pdao-archive-icon"><Archive size={16} /></span>
                    <div className="pdao-archive-text">
                        This DAO is archived — new proposals cannot be created
                    </div>
                </div>
            )}

            {!auth.isAuthenticated && (
                <div className="k-dashed pdao-connect-prompt">
                    <p>Connect your wallet to create a proposal</p>
                </div>
            )}

            {success && (
                <div className="pdao-success-bar">
                    <span>✓ {success}</span>
                    <button
                        className="pdao-success-goto"
                        onClick={() => navigate(`/dao/${encodedSlug}`)}
                    >
                        Go to DAO →
                    </button>
                </div>
            )}

            {/* Form */}
            <div className="k-card pdao-form">
                {/* Template Selector */}
                <div>
                    <label className="pdao-label">Template</label>
                    <div className="pdao-chip-row">
                        {PROPOSAL_TEMPLATES.map(t => (
                            <button
                                key={t.id}
                                type="button"
                                disabled={loading}
                                className={`pdao-chip ${selectedTemplate === t.id ? "active" : ""}`}
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
                            >
                                <span className="pdao-chip-icon"><t.icon size={14} /> {t.label}</span>
                            </button>
                        ))}
                    </div>
                    <p className="pdao-hint">Pre-fill title and description with a structured template</p>
                </div>

                {/* Proposal Type Selector */}
                <div>
                    <label className="pdao-label">Proposal Type</label>
                    <div className="pdao-chip-row">
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
                                className={`pdao-chip ${t.enabled && proposalType === t.id ? "active" : ""} ${!t.enabled ? "pdao-chip-disabled" : ""}`}
                            >
                                <span className="pdao-chip-icon"><t.icon size={14} /> {t.label}</span>
                            </button>
                        ))}
                    </div>
                </div>

                {/* Member-specific fields */}
                {proposalType === "member" && (
                    <>
                        <div>
                            <label className="pdao-label">Target Address</label>
                            <input
                                id="member-address-input"
                                className="pdao-input"
                                type="text" value={memberAddress}
                                onChange={(e) => setMemberAddress(e.target.value)}
                                placeholder="g1..." maxLength={42}
                                disabled={loading}
                            />
                            <p className="pdao-hint">The address of the member to add</p>
                        </div>
                        <div>
                            <label className="pdao-label">Roles</label>
                            <div className="pdao-chip-row">
                                {["admin", "dev", "finance", "ops", "member"].map(role => (
                                    <button
                                        key={role}
                                        type="button"
                                        onClick={() => setMemberRoles(prev =>
                                            prev.includes(role) ? prev.filter(r => r !== role) : [...prev, role]
                                        )}
                                        disabled={loading}
                                        className={`pdao-role-chip ${memberRoles.includes(role) ? "active" : ""}`}
                                    >
                                        {role}
                                    </button>
                                ))}
                            </div>
                            <p className="pdao-hint">Selected: {memberRoles.join(", ") || "none"}</p>
                        </div>
                    </>
                )}

                <div>
                    <label className="pdao-label">{proposalType === "member" ? "Title (optional)" : "Title"}</label>
                    <input
                        className="pdao-input"
                        type="text" value={title} onChange={(e) => setTitle(e.target.value)}
                        placeholder={proposalType === "member" ? "Auto-generated if empty" : "e.g. Add new member to DAO"}
                        maxLength={128}
                        disabled={loading}
                    />
                    <p className="pdao-hint">{title.length}/128 characters</p>
                </div>

                <div>
                    <label className="pdao-label">Description (optional)</label>
                    <textarea
                        className="pdao-textarea"
                        value={description} onChange={(e) => setDescription(e.target.value)}
                        placeholder="Describe the proposal in detail..."
                        maxLength={4096} rows={6}
                        disabled={loading}
                    />
                    <p className="pdao-hint">{description.length}/4096 characters</p>
                </div>

                {/* Category — not supported by GovDAO */}
                {!isGovDAO && (
                    <div>
                        <label className="pdao-label">Category</label>
                        <div className="pdao-chip-row">
                            {categories.map(c => (
                                <button
                                    key={c.value}
                                    type="button"
                                    onClick={() => setCategory(c.value)}
                                    disabled={loading}
                                    className={`pdao-chip ${category === c.value ? "active" : ""}`}
                                >
                                    {c.label}
                                </button>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            {/* Summary */}
            <div className="k-card pdao-summary">
                <div className="pdao-summary-row">
                    <span>Realm</span>
                    <span>{realmPath}</span>
                </div>
                <div className="pdao-summary-row">
                    <span>Function</span>
                    <span>Propose(title, description{isGovDAO ? "" : ", category"})</span>
                </div>
                <div className="pdao-summary-row">
                    <span>Proposer</span>
                    <span>{adena.address || "—"}</span>
                </div>
            </div>

            {/* Source Code Preview */}
            {auth.isAuthenticated && title.trim() && (
                <details className="pdao-source-details">
                    <summary className="pdao-source-summary">
                        📋 View Source Code (MsgCall)
                    </summary>
                    <pre className="pdao-source-pre">
                        {JSON.stringify(
                            buildProposeMsg(adena.address || "", realmPath, title.trim(), description.trim(), isGovDAO ? undefined : category),
                            null, 2,
                        )}
                    </pre>
                </details>
            )}

            {/* Submit */}
            <div className="pdao-actions">
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

