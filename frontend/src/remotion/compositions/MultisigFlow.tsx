/**
 * MultisigFlow — 10s animated multisig transaction signing flow.
 *
 * Matches real Memba multisig UX: signer list with addresses,
 * threshold display, progressive signatures, and DeploymentPipeline broadcast.
 */
import { useCurrentFrame, interpolate, spring, useVideoConfig } from "remotion"
import { MockUI, MockLabel, MockProgress } from "../components/MockUI"
import { COLORS, fontMono } from "../components/tokens"

const SIGNERS = [
    { addr: "g1jg8m...k9x2", label: "Member 1" },
    { addr: "g1k8p2...q4r6", label: "Member 2" },
    { addr: "g1r5t1...w3y8", label: "Member 3" },
]

export function MultisigFlow() {
    const frame = useCurrentFrame()
    const { fps } = useVideoConfig()

    // Timeline: 0-50 show signers, 50-150 signatures, 150-200 threshold met, 200-250 broadcast, 250-300 confirmed
    const phase1End = 50
    const phase2End = 150
    const thresholdMet = frame > 150
    const broadcasting = frame > 200
    const confirmed = frame > 250

    return (
        <MockUI title="Multisig · 2 of 3">
            {/* Transaction summary */}
            <div style={{
                padding: "5px 8px", borderRadius: 5,
                background: "#0c0c0c", border: "1px solid #222",
                display: "flex", justifyContent: "space-between", alignItems: "center",
            }}>
                <span style={{ fontSize: 7, fontFamily: fontMono, color: COLORS.muted }}>Send</span>
                <span style={{ fontSize: 8, fontFamily: fontMono, color: COLORS.text, fontWeight: 600 }}>50 GNOT</span>
                <span style={{ fontSize: 7, fontFamily: fontMono, color: COLORS.muted }}>→ g1abc...xyz</span>
            </div>

            {/* Signer list */}
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                <MockLabel>Signatures (2 of 3 required)</MockLabel>
                {SIGNERS.map((s, i) => {
                    const appear = spring({ frame: frame - i * 10, fps, config: { damping: 15 } })
                    const signed = frame > phase1End + i * 35
                    const sigSpring = spring({ frame: frame - (phase1End + i * 35), fps, config: { damping: 12 } })

                    return (
                        <div
                            key={s.addr}
                            style={{
                                opacity: appear,
                                transform: `translateY(${(1 - appear) * 6}px)`,
                                display: "flex", alignItems: "center", justifyContent: "space-between",
                                background: signed ? "rgba(76,175,80,0.04)" : "#0c0c0c",
                                border: `1px solid ${signed ? "rgba(76,175,80,0.15)" : "#222"}`,
                                borderRadius: 5, padding: "5px 8px",
                            }}
                        >
                            <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                                <div style={{
                                    width: 16, height: 16, borderRadius: "50%",
                                    background: "rgba(255,255,255,0.04)",
                                    display: "flex", alignItems: "center", justifyContent: "center",
                                    fontSize: 7, color: COLORS.muted, fontFamily: fontMono,
                                }}>
                                    {s.label.slice(-1)}
                                </div>
                                <div>
                                    <div style={{ fontSize: 8, fontWeight: 500, color: COLORS.text }}>{s.label}</div>
                                    <div style={{ fontSize: 6, fontFamily: fontMono, color: COLORS.muted }}>{s.addr}</div>
                                </div>
                            </div>
                            {signed ? (
                                <span style={{
                                    padding: "1px 4px", borderRadius: 3, fontSize: 6,
                                    fontFamily: fontMono, fontWeight: 600,
                                    background: "rgba(76,175,80,0.08)", color: "#4caf50",
                                    opacity: sigSpring,
                                }}>
                                    ✓ SIGNED
                                </span>
                            ) : (
                                <span style={{ fontSize: 6, fontFamily: fontMono, color: "#555" }}>Pending</span>
                            )}
                        </div>
                    )
                })}
            </div>

            {/* Progress bar */}
            <MockProgress
                value={interpolate(frame, [phase1End, phase2End], [0, 100], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })}
            />

            {/* CTA */}
            <div style={{ marginTop: "auto", display: "flex", justifyContent: "flex-end", gap: 6 }}>
                {!thresholdMet ? (
                    <span style={{ fontSize: 7, fontFamily: fontMono, color: COLORS.muted }}>
                        Waiting for signatures…
                    </span>
                ) : !confirmed ? (
                    <div style={{
                        opacity: spring({ frame: frame - 150, fps, config: { damping: 12 } }),
                        height: 20, borderRadius: 4, padding: "0 12px",
                        background: COLORS.accent, color: "#000",
                        fontSize: 8, fontWeight: 600, fontFamily: fontMono,
                        display: "flex", alignItems: "center",
                    }}>
                        {broadcasting ? "📡 Broadcasting..." : "⚡ Execute Transaction"}
                    </div>
                ) : (
                    <div style={{
                        display: "flex", alignItems: "center", gap: 4,
                        opacity: spring({ frame: frame - 250, fps, config: { damping: 12 } }),
                    }}>
                        <span style={{ fontSize: 10, color: COLORS.accent }}>✓</span>
                        <span style={{ fontSize: 8, fontWeight: 600, fontFamily: fontMono, color: COLORS.accent }}>Confirmed on-chain</span>
                    </div>
                )}
            </div>
        </MockUI>
    )
}
