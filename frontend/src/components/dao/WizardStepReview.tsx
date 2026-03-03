import { DAO_PRESETS } from "../../lib/daoTemplate"
import { GnoCodeBlock } from "../ui/GnoCodeBlock"
import { SummaryItem, ROLE_COLORS, ROLE_ICONS, type MemberInput, type Step } from "./wizardShared"

interface Props {
    name: string
    description: string
    realmPath: string
    selectedPreset: string | null
    threshold: number
    quorum: number
    availableRoles: string[]
    proposalCategories: string[]
    validMembers: MemberInput[]
    totalPower: number
    generatedCode: string
    deploying: boolean
    walletAddress: string
    onGoToStep: (s: Step) => void
    onDeploy: () => void
}

export function WizardStepReview({
    name, description, realmPath, selectedPreset,
    threshold, quorum, availableRoles, proposalCategories,
    validMembers, totalPower, generatedCode, deploying, walletAddress,
    onGoToStep, onDeploy,
}: Props) {
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* Summary */}
            <div className="k-card" style={{ padding: 20 }}>
                <h3 style={{ fontSize: 14, fontWeight: 600, color: "#f0f0f0", marginBottom: 16 }}>DAO Summary</h3>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <SummaryItem label="Name" value={name} />
                    <SummaryItem label="Preset" value={selectedPreset ? DAO_PRESETS.find((p) => p.id === selectedPreset)?.name || "Custom" : "Custom"} />
                    <SummaryItem label="Threshold" value={`${threshold}%`} accent />
                    <SummaryItem label="Quorum" value={quorum > 0 ? `${quorum}%` : "None"} accent={quorum > 0} />
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

                {/* Roles distribution */}
                <div style={{ marginTop: 16 }}>
                    <div style={{ fontSize: 9, color: "#555", textTransform: "uppercase", letterSpacing: "0.05em", fontFamily: "JetBrains Mono, monospace", marginBottom: 6 }}>
                        Roles
                    </div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        {availableRoles.map((role) => {
                            const count = validMembers.filter((m) => m.roles.includes(role)).length
                            const color = ROLE_COLORS[role] || "#888"
                            return (
                                <span key={role} style={{
                                    fontSize: 10, padding: "3px 10px", borderRadius: 4,
                                    background: `${color}15`, color,
                                    fontFamily: "JetBrains Mono, monospace",
                                }}>
                                    {ROLE_ICONS[role] || "•"} {role}: {count}
                                </span>
                            )
                        })}
                    </div>
                </div>

                {/* Categories */}
                <div style={{ marginTop: 12 }}>
                    <div style={{ fontSize: 9, color: "#555", textTransform: "uppercase", letterSpacing: "0.05em", fontFamily: "JetBrains Mono, monospace", marginBottom: 6 }}>
                        Proposal Categories
                    </div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {proposalCategories.map((cat) => (
                            <span key={cat} style={{
                                fontSize: 10, padding: "2px 8px", borderRadius: 4,
                                background: "rgba(0,212,170,0.08)", color: "#00d4aa",
                                fontFamily: "JetBrains Mono, monospace", textTransform: "capitalize",
                            }}>
                                {cat}
                            </span>
                        ))}
                    </div>
                </div>
            </div>

            {/* Members Preview */}
            <div className="k-card" style={{ padding: 20 }}>
                <h3 style={{ fontSize: 14, fontWeight: 600, color: "#f0f0f0", marginBottom: 12 }}>Members</h3>
                {validMembers.map((m, i) => (
                    <div key={i} style={{
                        display: "flex", justifyContent: "space-between", alignItems: "center",
                        padding: "8px 0", borderBottom: i < validMembers.length - 1 ? "1px solid rgba(255,255,255,0.05)" : "none",
                        flexWrap: "wrap", gap: 6,
                    }}>
                        <span style={{ fontSize: 11, color: "#ccc", fontFamily: "JetBrains Mono, monospace" }}>{m.address}</span>
                        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                            {m.roles.map((r) => (
                                <span key={r} style={{
                                    fontSize: 8, padding: "1px 5px", borderRadius: 3,
                                    background: `${ROLE_COLORS[r] || "#888"}15`,
                                    color: ROLE_COLORS[r] || "#888",
                                    fontFamily: "JetBrains Mono, monospace",
                                }}>
                                    {r}
                                </span>
                            ))}
                            <span style={{ fontSize: 11, color: "#00d4aa", fontFamily: "JetBrains Mono, monospace", marginLeft: 4 }}>power: {m.power}</span>
                        </div>
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
                <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                    <GnoCodeBlock code={generatedCode} maxHeight={400} />
                </div>
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
                <button className="k-btn-secondary" onClick={() => onGoToStep(3)} style={{ fontSize: 13, padding: "10px 20px" }}>
                    ← Back
                </button>
                {!walletAddress ? (
                    <button className="k-btn-primary" disabled style={{ fontSize: 13, padding: "12px 28px", opacity: 0.5 }}>
                        Connect Wallet to Deploy
                    </button>
                ) : (
                    <button
                        className="k-btn-primary"
                        onClick={onDeploy}
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
    )
}
