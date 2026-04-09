/**
 * TokenFactory — 10s animated GRC20 token deployment flow.
 *
 * Matches the real CreateToken.tsx form fields + DeploymentPipeline.tsx overlay.
 * Steps: Preparing → Signing → Broadcasting → Confirmed (exact Pipeline icons).
 */
import { useCurrentFrame, interpolate, spring, useVideoConfig } from "remotion"
import { MockUI } from "../components/MockUI"
import { COLORS, fontMono } from "../components/tokens"

// Exact step sequence from DeploymentPipeline.tsx
const DEPLOY_STEPS = [
    { icon: "📦", label: "Preparing", hint: "Building transaction..." },
    { icon: "✍️", label: "Signing", hint: "Waiting for wallet approval..." },
    { icon: "📡", label: "Broadcasting", hint: "Sending to the network..." },
    { icon: "✅", label: "Confirmed", hint: "Transaction confirmed on-chain" },
] as const

export function TokenFactory() {
    const frame = useCurrentFrame()
    const { fps } = useVideoConfig()

    // Timeline: 0-90 form, 90-100 deploy btn, 100-220 pipeline, 220-300 success
    const pipelineStart = 100
    const stepDuration = 30
    const pipelineDone = frame > pipelineStart + DEPLOY_STEPS.length * stepDuration

    const currentStep = Math.min(
        DEPLOY_STEPS.length - 1,
        Math.floor(interpolate(frame, [pipelineStart, pipelineStart + DEPLOY_STEPS.length * stepDuration], [0, DEPLOY_STEPS.length], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }))
    )

    return (
        <MockUI title="Create a Token">
            {!pipelineDone && (
                <>
                    {/* Form fields — exact match of CreateToken.tsx labels */}
                    <div style={{ display: "flex", flexDirection: "column", gap: 6, opacity: spring({ frame, fps, config: { damping: 15 } }) }}>
                        {[
                            { label: "Token Name", placeholder: "e.g. Your Token Name", value: "Gno Community" },
                            { label: "Symbol", placeholder: "e.g. $YTK", value: "GNC" },
                            { label: "Decimals", placeholder: "6", value: "6" },
                            { label: "Initial Mint", placeholder: "e.g. 1000000 (optional)", value: "1000000" },
                        ].map((f, i) => {
                            const typed = interpolate(frame, [i * 12, i * 12 + 30], [0, f.value.length], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
                            return (
                                <div key={f.label}>
                                    {/* Exact label style from CreateToken.tsx */}
                                    <span style={{
                                        display: "block", marginBottom: 2, fontSize: 6,
                                        fontFamily: fontMono, color: "var(--color-text-secondary)",
                                        textTransform: "uppercase", letterSpacing: "0.05em",
                                    }}>
                                        {f.label}
                                    </span>
                                    <div style={{
                                        height: 18, borderRadius: 4,
                                        background: "#0c0c0c", border: "1px solid #222",
                                        padding: "0 6px", display: "flex", alignItems: "center",
                                        fontSize: 7, fontFamily: fontMono, color: COLORS.text,
                                    }}>
                                        {typed < f.value.length
                                            ? <>
                                                {f.value.slice(0, Math.floor(typed))}
                                                <span style={{ color: COLORS.accent, opacity: Math.sin(frame * 0.3) > 0 ? 1 : 0 }}>▏</span>
                                            </>
                                            : f.value
                                        }
                                    </div>
                                </div>
                            )
                        })}
                    </div>

                    {/* Deploy button — matches real button style */}
                    {frame > 70 && frame < pipelineStart && (
                        <div style={{
                            height: 20, borderRadius: 4,
                            background: COLORS.accent, color: "#000",
                            fontFamily: fontMono, fontSize: 8, fontWeight: 600,
                            display: "flex", alignItems: "center", justifyContent: "center",
                            opacity: spring({ frame: frame - 70, fps, config: { damping: 12 } }),
                            letterSpacing: "-0.01em",
                        }}>
                            Create Token
                        </div>
                    )}
                </>
            )}

            {/* DeploymentPipeline overlay — exact match of real component */}
            {frame >= pipelineStart && !pipelineDone && (
                <div style={{
                    display: "flex", flexDirection: "column", gap: 4,
                    opacity: spring({ frame: frame - pipelineStart, fps, config: { damping: 12 } }),
                }}>
                    {/* Pipeline header */}
                    <div style={{ fontSize: 9, fontWeight: 600, color: COLORS.text }}>
                        🚀 Deploying...
                    </div>
                    {/* Step timeline — matches deploy-pipeline-timeline */}
                    {DEPLOY_STEPS.map((step, i) => {
                        const isDone = currentStep > i
                        const isActive = currentStep === i
                        return (
                            <div key={step.label} style={{
                                display: "flex", alignItems: "center", gap: 6,
                                opacity: spring({ frame: frame - (pipelineStart + i * 6), fps, config: { damping: 15 } }),
                                padding: "3px 0",
                            }}>
                                {/* Step icon — done shows ✓ in green circle */}
                                <div style={{
                                    width: 16, height: 16, borderRadius: "50%",
                                    background: isDone ? "rgba(0,212,170,0.15)" : isActive ? "rgba(0,212,170,0.06)" : "transparent",
                                    border: `1px solid ${isDone ? COLORS.accent : isActive ? "rgba(0,212,170,0.3)" : "#333"}`,
                                    display: "flex", alignItems: "center", justifyContent: "center",
                                    fontSize: isDone ? 7 : 8,
                                    color: isDone ? COLORS.accent : COLORS.muted,
                                    flexShrink: 0,
                                }}>
                                    {isDone ? "✓" : step.icon}
                                </div>
                                <div>
                                    <div style={{
                                        fontSize: 8, fontWeight: isDone || isActive ? 600 : 400,
                                        color: isDone ? COLORS.accent : isActive ? COLORS.text : COLORS.muted,
                                    }}>
                                        {step.label}
                                    </div>
                                    {isActive && (
                                        <div style={{ fontSize: 6, fontFamily: fontMono, color: COLORS.muted, marginTop: 1 }}>
                                            {step.hint}
                                        </div>
                                    )}
                                </div>
                            </div>
                        )
                    })}
                </div>
            )}

            {/* Success card — matches deploy-complete-card */}
            {pipelineDone && (
                <div style={{
                    opacity: spring({ frame: frame - (pipelineStart + DEPLOY_STEPS.length * stepDuration), fps, config: { damping: 12 } }),
                    display: "flex", flexDirection: "column", gap: 6, alignItems: "center",
                    padding: 10,
                }}>
                    <span style={{ fontSize: 20, color: COLORS.accent }}>✓</span>
                    <div style={{ fontSize: 11, fontWeight: 700, color: COLORS.accent }}>
                        Token deployed successfully!
                    </div>
                    <div style={{ textAlign: "center" }}>
                        <div style={{ fontSize: 10, fontWeight: 600, color: COLORS.text }}>Gno Community (GNC)</div>
                        <div style={{ fontSize: 7, fontFamily: fontMono, color: COLORS.muted, marginTop: 2 }}>
                            gno.land/r/demo/grc20factory
                        </div>
                    </div>
                    <div style={{
                        padding: "4px 12px", borderRadius: 5,
                        background: COLORS.accent, color: "#000",
                        fontSize: 8, fontWeight: 600, fontFamily: fontMono,
                    }}>
                        Open Token →
                    </div>
                </div>
            )}
        </MockUI>
    )
}
