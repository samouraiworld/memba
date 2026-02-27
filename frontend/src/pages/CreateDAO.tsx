import { useState, useCallback } from "react"
import { useNavigate, useOutletContext } from "react-router-dom"
import { ErrorToast } from "../components/ui/ErrorToast"
import { generateDAOCode, buildDeployDAOMsg, validateRealmPath, type DAOCreationConfig } from "../lib/daoTemplate"
import { addSavedDAO } from "../lib/daoSlug"
import type { LayoutContext } from "../types/layout"

// ── Types ─────────────────────────────────────────────────

interface MemberInput {
    address: string
    power: number
}

type Step = 1 | 2 | 3 | 4

// ── Main Component ────────────────────────────────────────

export function CreateDAO() {
    const navigate = useNavigate()
    const { adena } = useOutletContext<LayoutContext>()

    const [step, setStep] = useState<Step>(1)
    const [name, setName] = useState("")
    const [description, setDescription] = useState("")
    const [realmPath, setRealmPath] = useState("")
    const [members, setMembers] = useState<MemberInput[]>([{ address: "", power: 1 }])
    const [threshold, setThreshold] = useState(51)
    const [deploying, setDeploying] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [generatedCode, setGeneratedCode] = useState("")

    // Auto-fill realm path from connected wallet username
    const autoFillPath = useCallback(() => {
        if (!adena.address) return
        const shortAddr = adena.address.slice(0, 10)
        setRealmPath(`gno.land/r/${shortAddr}/${name.toLowerCase().replace(/[^a-z0-9]/g, "_").replace(/_+/g, "_").slice(0, 20) || "mydao"}`)
    }, [adena.address, name])

    // Add a member row
    const addMember = () => setMembers([...members, { address: "", power: 1 }])

    // Remove a member row
    const removeMember = (i: number) => {
        if (members.length <= 1) return
        setMembers(members.filter((_, idx) => idx !== i))
    }

    // Update a member
    const updateMember = (i: number, field: "address" | "power", value: string) => {
        const next = [...members]
        if (field === "power") {
            next[i] = { ...next[i], power: Math.max(1, parseInt(value) || 1) }
        } else {
            next[i] = { ...next[i], address: value.trim() }
        }
        setMembers(next)
    }

    // Generate preview code
    const previewCode = () => {
        const config: DAOCreationConfig = {
            name, description, realmPath, threshold,
            members: members.filter((m) => m.address.startsWith("g1")),
        }
        const code = generateDAOCode(config)
        setGeneratedCode(code)
    }

    // Go to step
    const goToStep = (s: Step) => {
        setError(null)
        if (s === 4) previewCode()
        setStep(s)
    }

    // Validate current step
    const validateStep = (): string | null => {
        if (step === 1) {
            if (!name.trim()) return "DAO name is required"
            if (name.length < 3) return "DAO name must be at least 3 characters"
            if (!realmPath.trim()) return "Realm path is required"
            const pathErr = validateRealmPath(realmPath)
            if (pathErr) return pathErr
        }
        if (step === 2) {
            const valid = members.filter((m) => m.address.startsWith("g1"))
            if (valid.length === 0) return "At least one member with a valid g1 address is required"
        }
        if (step === 3) {
            if (threshold < 1 || threshold > 100) return "Threshold must be between 1 and 100"
        }
        return null
    }

    // Proceed to next step
    const nextStep = () => {
        const err = validateStep()
        if (err) { setError(err); return }
        goToStep((step + 1) as Step)
    }

    // Deploy DAO
    const deployDAO = async () => {
        if (!adena.address) { setError("Connect your wallet first"); return }
        setDeploying(true)
        setError(null)
        try {
            const config: DAOCreationConfig = {
                name, description, realmPath, threshold,
                members: members.filter((m) => m.address.startsWith("g1")),
            }
            const code = generateDAOCode(config)
            const msg = buildDeployDAOMsg(adena.address, realmPath, code)

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const adenaWallet = (window as any).adena
            if (!adenaWallet?.DoContract) throw new Error("Adena wallet not available")

            const res = await adenaWallet.DoContract({
                messages: [{
                    type: "/vm.m_addpkg",
                    value: msg.value,
                }],
                gasFee: 1,
                gasWanted: 50000000, // higher gas for package deployment
                memo: `Deploy DAO: ${name}`,
            })

            if (res.status === "failure") {
                throw new Error(res.message || res.data?.message || "Deployment failed")
            }

            // Success — save DAO and redirect
            addSavedDAO(realmPath)
            const slug = realmPath.replace("gno.land/r/", "").replace(/\//g, "~")
            navigate(`/dao/${slug}`)
        } catch (err) {
            setError(err instanceof Error ? err.message : "Deployment failed")
        } finally {
            setDeploying(false)
        }
    }

    const validMembers = members.filter((m) => m.address.startsWith("g1"))
    const totalPower = validMembers.reduce((sum, m) => sum + m.power, 0)

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
                    🏗️ Create a DAO
                </h2>
                <p style={{ color: "#888", fontSize: 12, marginTop: 4, fontFamily: "JetBrains Mono, monospace" }}>
                    Deploy a new governance realm on gno.land
                </p>
            </div>

            {/* Step indicator */}
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {[1, 2, 3, 4].map((s) => (
                    <div key={s} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div
                            style={{
                                width: 28, height: 28, borderRadius: "50%",
                                display: "flex", alignItems: "center", justifyContent: "center",
                                fontSize: 12, fontWeight: 600, fontFamily: "JetBrains Mono, monospace",
                                background: s === step ? "#00d4aa" : s < step ? "rgba(0,212,170,0.2)" : "rgba(255,255,255,0.05)",
                                color: s === step ? "#000" : s < step ? "#00d4aa" : "#555",
                                cursor: s < step ? "pointer" : "default",
                                transition: "all 0.2s",
                            }}
                            onClick={() => s < step && goToStep(s as Step)}
                        >
                            {s < step ? "✓" : s}
                        </div>
                        {s < 4 && <div style={{ width: 24, height: 2, background: s < step ? "rgba(0,212,170,0.3)" : "rgba(255,255,255,0.05)" }} />}
                    </div>
                ))}
                <span style={{ fontSize: 11, color: "#666", marginLeft: 8, fontFamily: "JetBrains Mono, monospace" }}>
                    {step === 1 && "Name & Path"}
                    {step === 2 && "Members"}
                    {step === 3 && "Threshold"}
                    {step === 4 && "Review & Deploy"}
                </span>
            </div>

            {/* Step 1: Name & Path */}
            {step === 1 && (
                <div className="k-card" style={{ padding: 24, display: "flex", flexDirection: "column", gap: 20 }}>
                    <FormField label="DAO Name" hint="Display name for your DAO">
                        <input
                            id="dao-name-input"
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="My DAO"
                            style={inputStyle}
                            maxLength={50}
                        />
                    </FormField>

                    <FormField label="Description" hint="Short description (optional)">
                        <textarea
                            id="dao-desc-input"
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            placeholder="A governance DAO for..."
                            style={{ ...inputStyle, minHeight: 60, resize: "vertical" }}
                            maxLength={200}
                        />
                    </FormField>

                    <FormField label="Realm Path" hint="On-chain path (e.g., gno.land/r/username/mydao)">
                        <div style={{ display: "flex", gap: 8 }}>
                            <input
                                id="dao-path-input"
                                type="text"
                                value={realmPath}
                                onChange={(e) => setRealmPath(e.target.value)}
                                placeholder="gno.land/r/username/mydao"
                                style={{ ...inputStyle, flex: 1 }}
                            />
                            {adena.address && (
                                <button className="k-btn-secondary" onClick={autoFillPath} style={{ fontSize: 11, padding: "8px 12px", whiteSpace: "nowrap" }}>
                                    Auto-fill
                                </button>
                            )}
                        </div>
                        {realmPath && validateRealmPath(realmPath) && (
                            <p style={{ color: "#f5a623", fontSize: 11, marginTop: 4, fontFamily: "JetBrains Mono, monospace" }}>
                                ⚠ {validateRealmPath(realmPath)}
                            </p>
                        )}
                    </FormField>

                    <div style={{ display: "flex", justifyContent: "flex-end" }}>
                        <button className="k-btn-primary" onClick={nextStep} style={{ fontSize: 13, padding: "10px 24px" }}>
                            Next: Members →
                        </button>
                    </div>
                </div>
            )}

            {/* Step 2: Members */}
            {step === 2 && (
                <div className="k-card" style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <h3 style={{ fontSize: 14, fontWeight: 600, color: "#f0f0f0" }}>Initial Members</h3>
                        <span style={{ fontSize: 11, color: "#666", fontFamily: "JetBrains Mono, monospace" }}>
                            {validMembers.length} member{validMembers.length !== 1 ? "s" : ""} · Total power: {totalPower}
                        </span>
                    </div>

                    {members.map((m, i) => (
                        <div key={i} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                            <input
                                type="text"
                                value={m.address}
                                onChange={(e) => updateMember(i, "address", e.target.value)}
                                placeholder="g1..."
                                style={{ ...inputStyle, flex: 1 }}
                            />
                            <input
                                type="number"
                                value={m.power}
                                onChange={(e) => updateMember(i, "power", e.target.value)}
                                min="1"
                                max="100"
                                style={{ ...inputStyle, width: 70, textAlign: "center" }}
                            />
                            <span style={{ fontSize: 9, color: "#555", fontFamily: "JetBrains Mono, monospace", width: 40 }}>power</span>
                            {members.length > 1 && (
                                <button
                                    onClick={() => removeMember(i)}
                                    style={{ background: "none", border: "none", cursor: "pointer", color: "#f44", fontSize: 16, padding: 4 }}
                                >
                                    ×
                                </button>
                            )}
                        </div>
                    ))}

                    {adena.address && !members.some((m) => m.address === adena.address) && (
                        <button
                            className="k-btn-secondary"
                            onClick={() => setMembers([{ address: adena.address, power: 1 }, ...members])}
                            style={{ fontSize: 11, padding: "6px 12px", alignSelf: "flex-start" }}
                        >
                            + Add my address
                        </button>
                    )}

                    <button
                        onClick={addMember}
                        style={{
                            background: "none", border: "1px dashed rgba(0,212,170,0.3)", borderRadius: 8,
                            padding: "10px", cursor: "pointer", color: "#00d4aa", fontSize: 12,
                            fontFamily: "JetBrains Mono, monospace",
                        }}
                    >
                        + Add Member
                    </button>

                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <button className="k-btn-secondary" onClick={() => goToStep(1)} style={{ fontSize: 13, padding: "10px 20px" }}>
                            ← Back
                        </button>
                        <button className="k-btn-primary" onClick={nextStep} style={{ fontSize: 13, padding: "10px 24px" }}>
                            Next: Threshold →
                        </button>
                    </div>
                </div>
            )}

            {/* Step 3: Threshold */}
            {step === 3 && (
                <div className="k-card" style={{ padding: 24, display: "flex", flexDirection: "column", gap: 20 }}>
                    <FormField label="Voting Threshold" hint={`Percentage of total power required to pass a proposal`}>
                        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                            <input
                                type="range"
                                value={threshold}
                                onChange={(e) => setThreshold(parseInt(e.target.value))}
                                min="1"
                                max="100"
                                style={{ flex: 1 }}
                            />
                            <span style={{
                                fontSize: 20, fontWeight: 700, color: "#00d4aa",
                                fontFamily: "JetBrains Mono, monospace", minWidth: 50, textAlign: "center",
                            }}>
                                {threshold}%
                            </span>
                        </div>
                    </FormField>

                    <div className="k-card" style={{ padding: 16, background: "rgba(0,212,170,0.03)", border: "1px solid rgba(0,212,170,0.1)" }}>
                        <p style={{ fontSize: 12, color: "#aaa", fontFamily: "JetBrains Mono, monospace" }}>
                            With {validMembers.length} members and total power {totalPower}:
                        </p>
                        <p style={{ fontSize: 13, color: "#f0f0f0", marginTop: 4, fontFamily: "JetBrains Mono, monospace" }}>
                            A proposal needs <strong style={{ color: "#00d4aa" }}>{Math.ceil(totalPower * threshold / 100)}</strong> voting power to pass
                        </p>
                    </div>

                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <button className="k-btn-secondary" onClick={() => goToStep(2)} style={{ fontSize: 13, padding: "10px 20px" }}>
                            ← Back
                        </button>
                        <button className="k-btn-primary" onClick={nextStep} style={{ fontSize: 13, padding: "10px 24px" }}>
                            Next: Review →
                        </button>
                    </div>
                </div>
            )}

            {/* Step 4: Review & Deploy */}
            {step === 4 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                    {/* Summary */}
                    <div className="k-card" style={{ padding: 20 }}>
                        <h3 style={{ fontSize: 14, fontWeight: 600, color: "#f0f0f0", marginBottom: 16 }}>DAO Summary</h3>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                            <SummaryItem label="Name" value={name} />
                            <SummaryItem label="Threshold" value={`${threshold}%`} accent />
                            <SummaryItem label="Members" value={String(validMembers.length)} />
                            <SummaryItem label="Total Power" value={String(totalPower)} />
                        </div>
                        <div style={{ marginTop: 12 }}>
                            <SummaryItem label="Realm Path" value={realmPath} />
                        </div>
                        {description && (
                            <div style={{ marginTop: 8 }}>
                                <SummaryItem label="Description" value={description} />
                            </div>
                        )}
                    </div>

                    {/* Members Preview */}
                    <div className="k-card" style={{ padding: 20 }}>
                        <h3 style={{ fontSize: 14, fontWeight: 600, color: "#f0f0f0", marginBottom: 12 }}>Members</h3>
                        {validMembers.map((m, i) => (
                            <div key={i} style={{
                                display: "flex", justifyContent: "space-between", alignItems: "center",
                                padding: "8px 0", borderBottom: i < validMembers.length - 1 ? "1px solid rgba(255,255,255,0.05)" : "none",
                            }}>
                                <span style={{ fontSize: 11, color: "#ccc", fontFamily: "JetBrains Mono, monospace" }}>{m.address}</span>
                                <span style={{ fontSize: 11, color: "#00d4aa", fontFamily: "JetBrains Mono, monospace" }}>power: {m.power}</span>
                            </div>
                        ))}
                    </div>

                    {/* Code Preview (collapsible) */}
                    <details style={{ background: "rgba(255,255,255,0.02)", borderRadius: 12, border: "1px solid rgba(255,255,255,0.06)" }}>
                        <summary style={{
                            cursor: "pointer", padding: "14px 20px", fontSize: 12,
                            fontFamily: "JetBrains Mono, monospace", color: "#888",
                        }}>
                            📄 View Generated Gno Code ({generatedCode.split("\n").length} lines)
                        </summary>
                        <pre style={{
                            padding: "16px 20px", fontSize: 10, color: "#aaa",
                            fontFamily: "JetBrains Mono, monospace", overflow: "auto",
                            maxHeight: 400, borderTop: "1px solid rgba(255,255,255,0.06)",
                            whiteSpace: "pre-wrap", lineHeight: 1.5,
                        }}>
                            {generatedCode}
                        </pre>
                    </details>

                    {/* Warning */}
                    <div style={{
                        padding: "12px 16px", borderRadius: 8,
                        background: "rgba(245,166,35,0.06)", border: "1px solid rgba(245,166,35,0.15)",
                        fontSize: 11, color: "#f5a623", fontFamily: "JetBrains Mono, monospace",
                    }}>
                        ⚠ This will deploy immutable code on gno.land. Review carefully before deploying.
                    </div>

                    {/* Actions */}
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                        <button className="k-btn-secondary" onClick={() => goToStep(3)} style={{ fontSize: 13, padding: "10px 20px" }}>
                            ← Back
                        </button>
                        {!adena.address ? (
                            <button className="k-btn-primary" disabled style={{ fontSize: 13, padding: "12px 28px", opacity: 0.5 }}>
                                Connect Wallet to Deploy
                            </button>
                        ) : (
                            <button
                                className="k-btn-primary"
                                onClick={deployDAO}
                                disabled={deploying}
                                style={{
                                    fontSize: 13, padding: "12px 28px",
                                    opacity: deploying ? 0.7 : 1,
                                }}
                            >
                                {deploying ? "Deploying..." : "🚀 Deploy DAO"}
                            </button>
                        )}
                    </div>
                </div>
            )}

            <ErrorToast message={error} onDismiss={() => setError(null)} />
        </div>
    )
}

// ── Sub-Components ────────────────────────────────────────

function FormField({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
    return (
        <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: "#f0f0f0", display: "block", marginBottom: 6 }}>
                {label}
            </label>
            {hint && (
                <p style={{ fontSize: 10, color: "#666", marginBottom: 8, fontFamily: "JetBrains Mono, monospace" }}>
                    {hint}
                </p>
            )}
            {children}
        </div>
    )
}

function SummaryItem({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
    return (
        <div>
            <div style={{ fontSize: 9, color: "#555", textTransform: "uppercase", letterSpacing: "0.05em", fontFamily: "JetBrains Mono, monospace" }}>
                {label}
            </div>
            <div style={{
                fontSize: 13, fontWeight: accent ? 700 : 500,
                color: accent ? "#00d4aa" : "#f0f0f0",
                fontFamily: "JetBrains Mono, monospace", marginTop: 2,
                wordBreak: "break-all",
            }}>
                {value}
            </div>
        </div>
    )
}

// ── Styles ────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 8,
    padding: "10px 14px",
    fontSize: 13,
    color: "#f0f0f0",
    fontFamily: "JetBrains Mono, monospace",
    outline: "none",
    transition: "border-color 0.15s",
    width: "100%",
}
