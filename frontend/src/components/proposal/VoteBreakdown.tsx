/**
 * VoteBreakdown — VoteStat and TierVoteBlock components for proposal vote display.
 *
 * Extracted in v1.5.0 from ProposalView.tsx.
 * Updated to include ABSTAIN voter rendering.
 */
import type { VoteRecord } from "../../lib/dao/shared"

export function VoteStat({ label, count, color, icon }: { label: string; count: number; color: string; icon: string }) {
    return (
        <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 24, fontWeight: 700, fontFamily: "JetBrains Mono, monospace", color }}>
                {icon} {count}
            </div>
            <div style={{ fontSize: 10, color: "var(--color-text-secondary)", fontFamily: "JetBrains Mono, monospace", textTransform: "uppercase", letterSpacing: "0.05em", marginTop: 2 }}>
                {label}
            </div>
        </div>
    )
}

const tierColors: Record<string, string> = { T1: "#00d4aa", T2: "#2196f3", T3: "#f5a623" }

export function TierVoteBlock({ record }: { record: VoteRecord }) {
    const color = tierColors[record.tier] || "#888"
    return (
        <div style={{ borderLeft: `3px solid ${color}`, paddingLeft: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <span style={{ fontWeight: 600, fontSize: 12, color, fontFamily: "JetBrains Mono, monospace" }}>
                    {record.tier}
                </span>
                <span style={{ fontSize: 10, color: "var(--color-text-secondary)", fontFamily: "JetBrains Mono, monospace" }}>
                    VPPM {record.vppm}
                </span>
            </div>

            {/* YES voters */}
            {record.yesVoters.length > 0 && (
                <div style={{ marginBottom: 6 }}>
                    <span style={{ fontSize: 10, color: "var(--color-success)", fontFamily: "JetBrains Mono, monospace", fontWeight: 600 }}>
                        YES ({record.yesVoters.length})
                    </span>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 }}>
                        {record.yesVoters.map((v) => (
                            <a
                                key={v.username}
                                href={v.profileUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{
                                    padding: "2px 8px", borderRadius: 4, fontSize: 10,
                                    fontFamily: "JetBrains Mono, monospace",
                                    background: "rgba(76,175,80,0.08)", color: "var(--color-success)",
                                    textDecoration: "none", transition: "background 0.15s",
                                }}
                            >
                                {v.username}
                            </a>
                        ))}
                    </div>
                </div>
            )}

            {/* NO voters */}
            {record.noVoters.length > 0 && (
                <div style={{ marginBottom: 6 }}>
                    <span style={{ fontSize: 10, color: "var(--color-danger)", fontFamily: "JetBrains Mono, monospace", fontWeight: 600 }}>
                        NO ({record.noVoters.length})
                    </span>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 }}>
                        {record.noVoters.map((v) => (
                            <a
                                key={v.username}
                                href={v.profileUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{
                                    padding: "2px 8px", borderRadius: 4, fontSize: 10,
                                    fontFamily: "JetBrains Mono, monospace",
                                    background: "rgba(244,67,54,0.08)", color: "var(--color-danger)",
                                    textDecoration: "none",
                                }}
                            >
                                {v.username}
                            </a>
                        ))}
                    </div>
                </div>
            )}

            {/* ABSTAIN voters */}
            {record.abstainVoters.length > 0 && (
                <div style={{ marginBottom: 6 }}>
                    <span style={{ fontSize: 10, color: "var(--color-text-secondary)", fontFamily: "JetBrains Mono, monospace", fontWeight: 600 }}>
                        ABSTAIN ({record.abstainVoters.length})
                    </span>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 }}>
                        {record.abstainVoters.map((v) => (
                            <a
                                key={v.username}
                                href={v.profileUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{
                                    padding: "2px 8px", borderRadius: 4, fontSize: 10,
                                    fontFamily: "JetBrains Mono, monospace",
                                    background: "rgba(136,136,136,0.08)", color: "var(--color-text-secondary)",
                                    textDecoration: "none",
                                }}
                            >
                                {v.username}
                            </a>
                        ))}
                    </div>
                </div>
            )}

            {record.yesVoters.length === 0 && record.noVoters.length === 0 && record.abstainVoters.length === 0 && (
                <div style={{ fontSize: 10, color: "var(--color-text-muted)", fontFamily: "JetBrains Mono, monospace" }}>
                    No votes from this tier
                </div>
            )}
        </div>
    )
}
