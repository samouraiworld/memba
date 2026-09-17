import { FormField, type MemberInput, type Step } from "./wizardShared"
import { formatDuration } from "../../lib/templates/dao/v2/duration"

interface Props {
    threshold: number
    quorum: number
    proposalCategories: string[]
    validMembers: MemberInput[]
    totalPower: number
    windows: { votingPeriodSeconds: number; executionDelaySeconds: number; executionWindowSeconds: number }
    onThresholdChange: (v: number) => void
    onQuorumChange: (v: number) => void
    onToggleCategory: (cat: string) => void
    onGoToStep: (s: Step) => void
    onNext: () => void
}

export function WizardStepConfig({
    threshold, quorum, proposalCategories, validMembers, totalPower, windows,
    onThresholdChange, onQuorumChange, onToggleCategory, onGoToStep, onNext,
}: Props) {
    return (
        <div className="k-card" style={{ padding: 24, display: "flex", flexDirection: "column", gap: 20 }}>
            {/* Threshold */}
            <FormField label="Voting Threshold" hint="Share of all voting power that must vote YES. More than half is required.">
                <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                    <input
                        type="range"
                        value={threshold}
                        onChange={(e) => onThresholdChange(parseInt(e.target.value, 10))}
                        min="51"
                        max="100"
                        aria-label="Voting threshold"
                        style={{ flex: 1 }}
                    />
                    <span style={{
                        fontSize: 20, fontWeight: 700, color: "var(--color-primary)",
                        fontFamily: "var(--font-ui, JetBrains Mono, monospace)", minWidth: 50, textAlign: "center",
                    }}>
                        {threshold}%
                    </span>
                </div>
            </FormField>

            {/* Quorum */}
            <FormField label="Quorum" hint="Share of all voting power that must take part (YES, NO or ABSTAIN) before a proposal can pass (0 = no quorum)">
                <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                    <input
                        type="range"
                        value={quorum}
                        onChange={(e) => onQuorumChange(parseInt(e.target.value, 10))}
                        min="0"
                        max="100"
                        style={{ flex: 1 }}
                    />
                    <span style={{
                        fontSize: 20, fontWeight: 700, color: quorum > 0 ? "var(--color-accent-purple)" : "var(--color-text-muted)",
                        fontFamily: "var(--font-ui, JetBrains Mono, monospace)", minWidth: 50, textAlign: "center",
                    }}>
                        {quorum}%
                    </span>
                </div>
                {quorum > 0 && (
                    <div className="k-card" style={{ padding: 12, marginTop: 8, background: "rgba(123,97,255,0.04)", border: "1px solid rgba(123,97,255,0.12)" }}>
                        <p style={{ fontSize: "var(--pro-caption, 11px)", color: "var(--color-text-secondary)", fontFamily: "var(--font-ui, JetBrains Mono, monospace)" }}>
                            At least <strong style={{ color: "var(--color-k-purple-text)" }}>{Math.ceil(totalPower * quorum / 100)}</strong> voting power must participate before a proposal can pass or fail.
                        </p>
                    </div>
                )}
            </FormField>

            {/* Proposal Categories */}
            <FormField label="Proposal Categories" hint="Labels for text proposals. Membership changes and archiving have their own proposal types.">
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {["governance", "membership", "operations"].map((cat) => {
                        const active = proposalCategories.includes(cat)
                        return (
                            <button
                                key={cat}
                                onClick={() => onToggleCategory(cat)}
                                style={{
                                    fontSize: "var(--pro-caption, 11px)", padding: "6px 14px", borderRadius: 6, cursor: "pointer",
                                    fontFamily: "var(--font-ui, JetBrains Mono, monospace)", textTransform: "capitalize",
                                    background: active ? "rgba(0,212,170,0.08)" : "transparent",
                                    border: `1px solid ${active ? "rgba(0,212,170,0.3)" : "rgba(255,255,255,0.08)"}`,
                                    color: active ? "var(--color-brand)" : "var(--color-text-muted)",
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
                <p style={{ fontSize: "var(--pro-small, 12px)", color: "var(--color-text-secondary)", fontFamily: "var(--font-ui, JetBrains Mono, monospace)" }}>
                    With {validMembers.length} members and total power {totalPower}:
                </p>
                <p style={{ fontSize: "var(--pro-small, 13px)", color: "var(--color-text)", marginTop: 4, fontFamily: "var(--font-ui, JetBrains Mono, monospace)" }}>
                    A proposal needs <strong style={{ color: "var(--color-primary)" }}>{Math.ceil(totalPower * threshold / 100)}</strong> YES power to pass
                    {quorum > 0 && <> with at least <strong style={{ color: "var(--color-k-purple-text)" }}>{quorum}%</strong> participation</>}
                </p>
                <p style={{ fontSize: "var(--pro-small, 12px)", color: "var(--color-text-secondary)", marginTop: 8, fontFamily: "var(--font-ui, JetBrains Mono, monospace)" }}>
                    Voting lasts {formatDuration(windows.votingPeriodSeconds)}. An accepted proposal can be executed after {formatDuration(windows.executionDelaySeconds)} and during the following {formatDuration(windows.executionWindowSeconds)}; after that it lapses.
                </p>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between" }}>
                <button className="k-btn-secondary" onClick={() => onGoToStep(2)} style={{ fontSize: "var(--pro-small, 13px)", padding: "10px 20px" }}>
                    ← Back
                </button>
                <button className="k-btn-primary" onClick={onNext} style={{ fontSize: "var(--pro-small, 13px)", padding: "10px 24px" }}>
                    Next: Extensions →
                </button>
            </div>
        </div>
    )
}
