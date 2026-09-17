import { DAO_PRESETS } from "../../lib/daoTemplate"
import { formatDuration } from "../../lib/templates/dao/v2/duration"
import { formatGnot } from "../../lib/templates/dao/v2/deposit"
import { GnoCodeBlock } from "../ui/GnoCodeBlock"
import { SummaryItem, ROLE_COLORS, ROLES_ARE_LABELS, SoloPowerWarning, type MemberInput, type Step } from "./wizardShared"
import { membersWhoCanPassAlone } from "../../lib/daoTemplate"

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
    networkLabel: string
    chainId: string
    windows: { votingPeriodSeconds: number; executionDelaySeconds: number; executionWindowSeconds: number }
    depositEstimateUgnot: number
    depositCapUgnot: number
    deployGas: number
    networkFeeUgnot: number
    /** Fee of the channels companion deploy (profile budget), shown when it is planned. */
    channelsFeeUgnot: number
    channelsPlanned: boolean
    confirmed: boolean
    onConfirmChange: (confirmed: boolean) => void
    onGoToStep: (s: Step) => void
    onDeploy: () => void
}

const noticeStyle = {
    padding: "12px 16px", borderRadius: 8,
    background: "rgba(245,166,35,0.06)", border: "1px solid rgba(245,166,35,0.15)",
    fontSize: "var(--pro-caption, 11px)", color: "var(--color-text)", fontFamily: "var(--font-ui, JetBrains Mono, monospace)",
    lineHeight: 1.6,
} as const

export function WizardStepReview({
    name, description, realmPath, selectedPreset,
    threshold, quorum, availableRoles, proposalCategories,
    validMembers, totalPower, generatedCode, deploying, walletAddress,
    networkLabel, chainId, windows, depositEstimateUgnot, depositCapUgnot, deployGas, networkFeeUgnot, channelsFeeUgnot, channelsPlanned,
    confirmed, onConfirmChange, onGoToStep, onDeploy,
}: Props) {
    const signatures = channelsPlanned ? 2 : 1
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* Summary */}
            <div className="k-card" style={{ padding: 20 }}>
                <h3 style={{ fontSize: "var(--pro-body, 14px)", fontWeight: 600, color: "var(--color-text)", marginBottom: 16 }}>DAO Summary</h3>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <SummaryItem label="Name" value={name} />
                    <SummaryItem label="Preset" value={selectedPreset ? DAO_PRESETS.find((p) => p.id === selectedPreset)?.name || "Custom" : "Custom"} />
                    <SummaryItem label="Network" value={`${networkLabel} (${chainId})`} accent />
                    <SummaryItem label="Signatures" value={String(signatures)} />
                    <SummaryItem label="Threshold" value={`${threshold}% of all voting power`} accent />
                    <SummaryItem label="Quorum" value={quorum > 0 ? `${quorum}%` : "None"} accent={quorum > 0} />
                    <SummaryItem label="Voting period" value={formatDuration(windows.votingPeriodSeconds)} />
                    <SummaryItem label="Execution delay" value={formatDuration(windows.executionDelaySeconds)} />
                    <SummaryItem label="Execution window" value={formatDuration(windows.executionWindowSeconds)} />
                    <SummaryItem label="Members and total power" value={`${validMembers.length} members, power ${totalPower}`} />
                </div>
                <div style={{ marginTop: 12 }}>
                    <SummaryItem label="Realm path (permanent, cannot be changed or reused)" value={realmPath} />
                </div>
                {description && (
                    <div style={{ marginTop: 8 }}>
                        <SummaryItem label="Description" value={description} />
                    </div>
                )}
                <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <SummaryItem label="Role labels" value={availableRoles.join(", ") || "None"} />
                    <SummaryItem label="Proposal categories" value={proposalCategories.join(", ")} />
                </div>
                <p style={{ fontSize: "var(--pro-caption, 11px)", color: "var(--color-text-secondary)", fontFamily: "var(--font-ui, JetBrains Mono, monospace)", margin: "8px 0 0" }}>
                    {ROLES_ARE_LABELS} Voting power decides every change.
                </p>
            </div>

            {/* Members Preview */}
            <div className="k-card" style={{ padding: 20 }}>
                <h3 style={{ fontSize: "var(--pro-body, 14px)", fontWeight: 600, color: "var(--color-text)", marginBottom: 4 }}>Members</h3>
                <p style={{ fontSize: "var(--pro-caption, 11px)", color: "var(--color-text-secondary)", fontFamily: "var(--font-ui, JetBrains Mono, monospace)", margin: "0 0 8px" }}>{ROLES_ARE_LABELS}</p>
                {validMembers.map((m, i) => (
                    <div key={m.address} style={{
                        display: "flex", justifyContent: "space-between", alignItems: "center",
                        padding: "8px 0", borderBottom: i < validMembers.length - 1 ? "1px solid rgba(255,255,255,0.05)" : "none",
                        flexWrap: "wrap", gap: 6,
                    }}>
                        <span style={{ fontSize: "var(--pro-caption, 11px)", color: "var(--color-text-secondary)", fontFamily: "JetBrains Mono, monospace" }}>{m.address}</span>
                        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                            {m.roles.map((r) => (
                                <span key={r} style={{
                                    fontSize: "var(--pro-caption, 8px)", padding: "1px 5px", borderRadius: 3,
                                    background: `${ROLE_COLORS[r] || "var(--color-text-secondary)"}15`,
                                    color: ROLE_COLORS[r] || "var(--color-text-secondary)",
                                    fontFamily: "var(--font-ui, JetBrains Mono, monospace)",
                                }}>
                                    {r}
                                </span>
                            ))}
                            <span style={{ fontSize: "var(--pro-caption, 11px)", color: "var(--color-primary)", fontFamily: "var(--font-ui, JetBrains Mono, monospace)", marginLeft: 4 }}>power: {m.power}</span>
                        </div>
                    </div>
                ))}
            </div>

            {/* Code Preview (collapsible) */}
            <details style={{ background: "rgba(255,255,255,0.02)", borderRadius: 12, border: "1px solid rgba(255,255,255,0.06)" }}>
                <summary style={{
                    cursor: "pointer", padding: "14px 20px", fontSize: "var(--pro-small, 12px)",
                    fontFamily: "var(--font-ui, JetBrains Mono, monospace)", color: "var(--color-text-secondary)",
                }}>
                    📄 View Generated Gno Code ({generatedCode.split("\n").length} lines)
                </summary>
                <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                    <GnoCodeBlock code={generatedCode} maxHeight={400} />
                </div>
            </details>

            <SoloPowerWarning addresses={membersWhoCanPassAlone(validMembers, threshold, quorum)} />

            {/* What you are about to do */}
            <div style={noticeStyle} data-testid="dao-deploy-disclosure">
                <div><strong>Storage deposit:</strong> about {formatGnot(depositEstimateUgnot)}, capped at {formatGnot(depositCapUgnot)}. It is locked to the realm and refunded only when its storage is freed. Storage deposits for removed members are refunded to whoever executes the removal.</div>
                <div><strong>Network fee:</strong> up to {formatGnot(networkFeeUgnot)} (your wallet may lower it). Gas limit {deployGas.toLocaleString("en-US")}.</div>
                {channelsPlanned && (
                    <div><strong>Channels companion (second signature):</strong> storage deposit cap {formatGnot(depositCapUgnot)}, network fee up to {formatGnot(channelsFeeUgnot)}.</div>
                )}
                <div><strong>Roles grant no special powers. Voting power decides.</strong> Every change is a proposal that passes by vote.</div>
                <div><strong>This DAO cannot hold funds.</strong> Do not send tokens to its address.</div>
                <div>The code and the realm path are permanent once deployed.</div>
            </div>

            <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: "var(--pro-small, 12px)", color: "var(--color-text)", cursor: "pointer" }}>
                <input
                    type="checkbox"
                    checked={confirmed}
                    onChange={(e) => onConfirmChange(e.target.checked)}
                    disabled={deploying}
                />
                <span>I understand this deploys a permanent contract on {networkLabel}</span>
            </label>

            {/* Actions */}
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                <button className="k-btn-secondary" onClick={() => onGoToStep(4)} disabled={deploying} style={{ fontSize: "var(--pro-small, 13px)", padding: "10px 20px" }}>
                    ← Back
                </button>
                {!walletAddress ? (
                    <button className="k-btn-primary" disabled style={{ fontSize: "var(--pro-small, 13px)", padding: "12px 28px", opacity: 0.5 }}>
                        Connect Wallet to Deploy
                    </button>
                ) : (
                    <button
                        className="k-btn-primary"
                        onClick={onDeploy}
                        disabled={deploying || !confirmed}
                        style={{
                            fontSize: "var(--pro-small, 13px)", padding: "12px 28px",
                            opacity: deploying || !confirmed ? 0.6 : 1,
                        }}
                    >
                        {deploying ? "Deploying..." : "Deploy DAO"}
                    </button>
                )}
            </div>
        </div>
    )
}
