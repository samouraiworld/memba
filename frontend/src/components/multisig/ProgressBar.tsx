interface ProgressBarProps {
    /** signatures submitted (raw rows — what the broadcast gate counts) */
    current: number;
    /** signatures that passed server-side verification (A3) */
    verified: number;
    threshold: number;
    total: number;
}

export function ProgressBar({ current, verified, threshold, total }: ProgressBarProps) {
    const submittedPct = total > 0 ? (current / total) * 100 : 0;
    const verifiedPct = total > 0 ? (verified / total) * 100 : 0;
    const thresholdPercentage = total > 0 ? (threshold / total) * 100 : 0;
    // The broadcast gate counts submitted rows (unchanged during the A3
    // log-only window); "ready" display additionally requires them verified.
    const quorumSubmitted = current >= threshold;
    const quorumVerified = verified >= threshold;
    const isReady = quorumSubmitted && quorumVerified;

    return (
        <div className="k-card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {/* Bar */}
            <div style={{ position: "relative", height: 8, background: "var(--color-k-edge)", borderRadius: 4, overflow: "visible" }}>
                {/* Submitted fill (lighter — includes unverified signatures) */}
                <div
                    style={{
                        position: "absolute", top: 0, left: 0, height: "100%",
                        width: `${Math.min(submittedPct, 100)}%`,
                        background: "var(--color-k-amber-subtle)",
                        border: "1px solid var(--color-k-amber-border)",
                        borderRadius: 4,
                        transition: "width 0.3s ease",
                    }}
                />
                {/* Verified fill */}
                <div
                    style={{
                        position: "absolute", top: 0, left: 0, height: "100%",
                        width: `${Math.min(verifiedPct, 100)}%`,
                        background: isReady
                            ? "linear-gradient(90deg, var(--color-k-accent), var(--color-k-accent-hover))"
                            : "linear-gradient(90deg, var(--color-k-warning), var(--color-accent-gold-bright))",
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
                        background: "var(--color-k-accent)",
                        borderRadius: 1,
                    }}
                />
            </div>

            {/* Labels */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 16, fontWeight: 600, color: quorumVerified ? "var(--color-k-accent)" : "var(--color-k-warning)" }}>
                        {verified}/{threshold} verified
                    </span>
                    <span className="k-label">·</span>
                    <span className="k-label">{current} submitted</span>
                </div>
                <span style={{
                    fontSize: 11, padding: "2px 8px", borderRadius: 4,
                    fontFamily: "JetBrains Mono, monospace",
                    background: isReady ? "var(--color-k-accent-subtle)" : "var(--color-k-amber-subtle)",
                    color: isReady ? "var(--color-k-accent)" : "var(--color-k-warning)",
                    border: `1px solid ${isReady ? "var(--color-k-accent-border)" : "var(--color-k-amber-border)"}`,
                }}>
                    {isReady
                        ? "Ready to broadcast"
                        : quorumSubmitted
                            ? "Quorum includes unverified signatures"
                            : `${threshold - current} more needed`}
                </span>
            </div>
        </div>
    )
}
