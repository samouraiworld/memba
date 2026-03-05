import { FormField, type MemberInput, type Step } from "./wizardShared"

interface Props {
    threshold: number
    quorum: number
    proposalCategories: string[]
    validMembers: MemberInput[]
    totalPower: number
    onThresholdChange: (v: number) => void
    onQuorumChange: (v: number) => void
    onToggleCategory: (cat: string) => void
    onGoToStep: (s: Step) => void
    onNext: () => void
}

export function WizardStepConfig({
    threshold, quorum, proposalCategories, validMembers, totalPower,
    onThresholdChange, onQuorumChange, onToggleCategory, onGoToStep, onNext,
}: Props) {
    return (
        <div className="k-card" style={{ padding: 24, display: "flex", flexDirection: "column", gap: 20 }}>
            {/* Threshold */}
            <FormField label="Voting Threshold" hint="Percentage of total power required to pass a proposal">
                <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                    <input
                        type="range"
                        value={threshold}
                        onChange={(e) => onThresholdChange(parseInt(e.target.value))}
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

            {/* Quorum */}
            <FormField label="Quorum" hint="Minimum participation % before any proposal can pass (0 = no quorum)">
                <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                    <input
                        type="range"
                        value={quorum}
                        onChange={(e) => onQuorumChange(parseInt(e.target.value))}
                        min="0"
                        max="100"
                        style={{ flex: 1 }}
                    />
                    <span style={{
                        fontSize: 20, fontWeight: 700, color: quorum > 0 ? "#7b61ff" : "#555",
                        fontFamily: "JetBrains Mono, monospace", minWidth: 50, textAlign: "center",
                    }}>
                        {quorum}%
                    </span>
                </div>
                {quorum > 0 && (
                    <div className="k-card" style={{ padding: 12, marginTop: 8, background: "rgba(123,97,255,0.04)", border: "1px solid rgba(123,97,255,0.12)" }}>
                        <p style={{ fontSize: 11, color: "#aaa", fontFamily: "JetBrains Mono, monospace" }}>
                            At least <strong style={{ color: "#7b61ff" }}>{Math.ceil(totalPower * quorum / 100)}</strong> voting power must participate before a proposal can pass or fail.
                        </p>
                    </div>
                )}
            </FormField>

            {/* Proposal Categories */}
            <FormField label="Proposal Categories" hint="Types of proposals allowed in this DAO">
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {["governance", "treasury", "membership", "operations"].map((cat) => {
                        const active = proposalCategories.includes(cat)
                        return (
                            <button
                                key={cat}
                                onClick={() => onToggleCategory(cat)}
                                style={{
                                    fontSize: 11, padding: "6px 14px", borderRadius: 6, cursor: "pointer",
                                    fontFamily: "JetBrains Mono, monospace", textTransform: "capitalize",
                                    background: active ? "rgba(0,212,170,0.08)" : "transparent",
                                    border: `1px solid ${active ? "rgba(0,212,170,0.3)" : "rgba(255,255,255,0.08)"}`,
                                    color: active ? "#00d4aa" : "#555",
                                    transition: "all 0.15s",
                                }}
                            >
                                {active ? "✓ " : ""}{cat}
                            </button>
                        )
                    })}
                </div>
            </FormField>

            {/* Summary card */}
            <div className="k-card" style={{ padding: 16, background: "rgba(0,212,170,0.03)", border: "1px solid rgba(0,212,170,0.1)" }}>
                <p style={{ fontSize: 12, color: "#aaa", fontFamily: "JetBrains Mono, monospace" }}>
                    With {validMembers.length} members and total power {totalPower}:
                </p>
                <p style={{ fontSize: 13, color: "#f0f0f0", marginTop: 4, fontFamily: "JetBrains Mono, monospace" }}>
                    A proposal needs <strong style={{ color: "#00d4aa" }}>{Math.ceil(totalPower * threshold / 100)}</strong> YES power to pass
                    {quorum > 0 && <> with at least <strong style={{ color: "#7b61ff" }}>{quorum}%</strong> participation</>}
                </p>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between" }}>
                <button className="k-btn-secondary" onClick={() => onGoToStep(2)} style={{ fontSize: 13, padding: "10px 20px" }}>
                    ← Back
                </button>
                <button className="k-btn-primary" onClick={onNext} style={{ fontSize: 13, padding: "10px 24px" }}>
                    Next: Extensions →
                </button>
            </div>
        </div>
    )
}
