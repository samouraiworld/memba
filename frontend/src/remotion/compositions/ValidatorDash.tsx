/**
 * ValidatorDash — 8s animated validator dashboard showcase.
 *
 * Matches real Validators.tsx: val-stats-grid (4 cards),
 * val-power-bar (horizontal segments), val-table (rank/moniker/power/share/status).
 */
import { useCurrentFrame, interpolate, spring, useVideoConfig } from "remotion"
import { MockUI, MockLabel } from "../components/MockUI"
import { COLORS, fontMono } from "../components/tokens"

// Real stat labels from Validators.tsx
const STATS = [
    { label: "Block Height", value: "1,284,391", hint: "✅ Synced" },
    { label: "Avg Block Time", value: "2.1s", hint: "Last 10 blocks" },
    { label: "Active Validators", value: "23", hint: "Consensus set" },
    { label: "Total Voting Power", value: "1.2M", hint: "Network weight" },
]

// Realistic validator data (generic names)
const VALIDATORS = [
    { rank: 1, moniker: "gnolove", power: "180,432", share: 14.8, active: true },
    { rank: 2, moniker: "teritori", power: "156,201", share: 12.8, active: true },
    { rank: 3, moniker: "onbloc", power: "142,890", share: 11.7, active: true },
    { rank: 4, moniker: "berty", power: "98,456", share: 8.1, active: true },
    { rank: 5, moniker: "gnoswap", power: "87,123", share: 7.2, active: true },
]

export function ValidatorDash() {
    const frame = useCurrentFrame()
    const { fps } = useVideoConfig()

    return (
        <MockUI title="⛓️ Validators">
            {/* val-stats-grid — 4 stat cards */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 3 }}>
                {STATS.map((s, i) => {
                    const appear = spring({ frame: frame - i * 5, fps, config: { damping: 15 } })
                    return (
                        <div key={s.label} style={{
                            opacity: appear,
                            transform: `translateY(${(1 - appear) * 5}px)`,
                            background: "#0c0c0c", border: "1px solid #222", borderRadius: 5,
                            padding: "4px 6px", display: "flex", flexDirection: "column", gap: 1,
                        }}>
                            {/* val-stat-label */}
                            <span style={{ fontSize: 5, fontFamily: fontMono, color: "#666", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                                {s.label}
                            </span>
                            {/* val-stat-value */}
                            <span style={{ fontSize: 9, fontWeight: 700, color: COLORS.text, fontFamily: fontMono }}>
                                {s.value}
                            </span>
                            {/* val-stat-hint */}
                            <span style={{ fontSize: 5, fontFamily: fontMono, color: "#555" }}>
                                {s.hint}
                            </span>
                        </div>
                    )
                })}
            </div>

            {/* val-power-bar — horizontal segments like real component */}
            <div style={{ marginTop: 2 }}>
                <MockLabel>Voting Power Distribution</MockLabel>
                <div style={{
                    height: 7, borderRadius: 4, overflow: "hidden", display: "flex",
                    marginTop: 2, background: "rgba(255,255,255,0.03)",
                }}>
                    {VALIDATORS.map((v, i) => {
                        const barW = interpolate(frame, [25 + i * 6, 55 + i * 6], [0, v.share], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
                        return (
                            <div key={v.moniker} style={{
                                height: "100%", width: `${barW}%`,
                                background: COLORS.accent,
                                opacity: 0.4 + (0.6 * (1 - i / VALIDATORS.length)),
                                borderRight: i < VALIDATORS.length - 1 ? "1px solid #000" : "none",
                            }} />
                        )
                    })}
                </div>
            </div>

            {/* val-table — matches real table structure */}
            <div style={{ marginTop: 2, display: "flex", flexDirection: "column", gap: 0 }}>
                {/* Header — val-th */}
                <div style={{
                    display: "grid", gridTemplateColumns: "16px 1fr 50px 36px 30px",
                    gap: 3, padding: "2px 4px",
                    borderBottom: "1px solid #222",
                }}>
                    {["#", "Validator", "Power", "Share", "Status"].map(h => (
                        <span key={h} style={{
                            fontSize: 5, fontFamily: fontMono, color: "#555",
                            textTransform: "uppercase", letterSpacing: "0.04em",
                            textAlign: h === "Share" || h === "Status" ? "right" : "left",
                        }}>
                            {h}
                        </span>
                    ))}
                </div>
                {/* Rows — val-row */}
                {VALIDATORS.map((v, i) => {
                    const appear = spring({ frame: frame - 40 - i * 8, fps, config: { damping: 15 } })
                    return (
                        <div key={v.moniker} style={{
                            opacity: appear,
                            transform: `translateX(${(1 - appear) * 8}px)`,
                            display: "grid", gridTemplateColumns: "16px 1fr 50px 36px 30px",
                            gap: 3, padding: "3px 4px", borderRadius: 2,
                            background: i % 2 === 0 ? "rgba(255,255,255,0.01)" : "transparent",
                        }}>
                            {/* val-rank-badge — top 3 get accent color */}
                            <span style={{
                                fontSize: 7, fontFamily: fontMono,
                                color: v.rank <= 3 ? COLORS.accent : "#666",
                                fontWeight: v.rank <= 3 ? 700 : 400,
                            }}>
                                {v.rank}
                            </span>
                            {/* val-moniker */}
                            <span style={{ fontSize: 7, fontFamily: fontMono, color: COLORS.text }}>{v.moniker}</span>
                            {/* Voting Power */}
                            <span style={{ fontSize: 7, fontFamily: fontMono, color: "#888", textAlign: "right" }}>{v.power}</span>
                            {/* Share with mini bar */}
                            <span style={{ fontSize: 7, fontFamily: fontMono, color: COLORS.accent, textAlign: "right" }}>{v.share}%</span>
                            {/* Status */}
                            <span style={{
                                fontSize: 6, fontFamily: fontMono, textAlign: "right",
                                color: v.active ? "#4caf50" : "#f44336",
                            }}>
                                {v.active ? "Active" : "—"}
                            </span>
                        </div>
                    )
                })}
            </div>
        </MockUI>
    )
}
