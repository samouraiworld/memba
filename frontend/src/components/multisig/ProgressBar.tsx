interface ProgressBarProps {
    current: number;
    threshold: number;
    total: number;
}

export function ProgressBar({ current, threshold, total }: ProgressBarProps) {
    const percentage = total > 0 ? (current / total) * 100 : 0;
    const thresholdPercentage = total > 0 ? (threshold / total) * 100 : 0;
    const isReady = current >= threshold;

    return (
        <div className="k-card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {/* Bar */}
            <div style={{ position: "relative", height: 8, background: "#1a1a1a", borderRadius: 4, overflow: "visible" }}>
                {/* Fill */}
                <div
                    style={{
                        position: "absolute", top: 0, left: 0, height: "100%",
                        width: `${Math.min(percentage, 100)}%`,
                        background: isReady
                            ? "linear-gradient(90deg, #00d4aa, #00e6bb)"
                            : "linear-gradient(90deg, #ffa502, #ffbb33)",
                        borderRadius: 4,
                        transition: "width 0.3s ease, background 0.3s ease",
                    }}
                />
                {/* Threshold marker */}
                <div
                    style={{
                        position: "absolute", top: -4, left: `${thresholdPercentage}%`,
                        transform: "translateX(-50%)",
                        width: 2, height: 16,
                        background: "#00d4aa",
                        borderRadius: 1,
                    }}
                />
            </div>

            {/* Labels */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 16, fontWeight: 600, color: isReady ? "#00d4aa" : "#ffa502" }}>
                        {current}/{threshold}
                    </span>
                    <span className="k-label">signatures</span>
                </div>
                <span style={{
                    fontSize: 11, padding: "2px 8px", borderRadius: 4,
                    fontFamily: "JetBrains Mono, monospace",
                    background: isReady ? "rgba(0,212,170,0.08)" : "rgba(255,165,2,0.08)",
                    color: isReady ? "#00d4aa" : "#ffa502",
                    border: `1px solid ${isReady ? "rgba(0,212,170,0.2)" : "rgba(255,165,2,0.2)"}`,
                }}>
                    {isReady ? "Ready to broadcast" : `${threshold - current} more needed`}
                </span>
            </div>
        </div>
    )
}
