/**
 * DAOCards — StatCard and TierBar presentational components.
 *
 * Extracted in v1.5.0 from DAOHome.tsx.
 */
import type { TierInfo } from "../../lib/dao/shared"

export function StatCard({ label, value, icon, accent }: { label: string; value: string; icon: string; accent?: boolean }) {
    return (
        <div className="k-card" style={{ padding: "14px 16px", display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 20 }}>{icon}</span>
            <div>
                <div style={{
                    fontSize: 18, fontWeight: 700,
                    color: accent ? "#00d4aa" : "#f0f0f0",
                    fontFamily: "JetBrains Mono, monospace",
                }}>
                    {value}
                </div>
                <div style={{ fontSize: 9, color: "var(--color-text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em", fontFamily: "JetBrains Mono, monospace" }}>
                    {label}
                </div>
            </div>
        </div>
    )
}

export function TierBar({ tier, totalPower }: { tier: TierInfo; totalPower: number }) {
    const pct = totalPower > 0 ? Math.round((tier.power / totalPower) * 100) : 0
    const tierColors: Record<string, string> = {
        T1: "#00d4aa",
        T2: "#2196f3",
        T3: "#f5a623",
    }
    const color = tierColors[tier.tier] || "#888"

    return (
        <div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, fontFamily: "JetBrains Mono, monospace", marginBottom: 4 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{
                        display: "inline-block", width: 8, height: 8, borderRadius: "50%",
                        background: color,
                    }} />
                    <span style={{ color: "var(--color-text-secondary)", fontWeight: 600 }}>{tier.tier}</span>
                    <span style={{ color: "var(--color-text-secondary)" }}>• {tier.memberCount} members</span>
                </div>
                <span style={{ color }}>
                    {tier.power} power ({pct}%)
                </span>
            </div>
            <div style={{ height: 6, background: "#1a1a1a", borderRadius: 3, overflow: "hidden" }}>
                <div style={{
                    width: `${pct}%`, height: "100%",
                    background: `linear-gradient(90deg, ${color}, ${color}88)`,
                    borderRadius: 3, transition: "width 0.4s ease",
                }} />
            </div>
        </div>
    )
}
