/**
 * ConnectingLoader — Elegant loading state shown during wallet connect → auth flow.
 *
 * Replaces the black screen gap between "Connect Wallet" click and Dashboard render.
 * Shows Memba branding with indeterminate progress bar.
 */

export function ConnectingLoader() {
    return (
        <div
            role="status"
            aria-live="polite"
            style={{
                display: "flex", flexDirection: "column", alignItems: "center",
                justifyContent: "center", minHeight: "60vh", gap: 24, animation: "fadeIn 0.3s ease-out",
            }}
        >
            {/* Memba logo with pulse */}
            <div
                className="animate-glow"
                style={{
                    width: 80, height: 80, borderRadius: 16,
                    display: "flex", alignItems: "center", justifyContent: "center",
                }}
            >
                <img src="/memba-icon.png" alt="Memba" style={{ width: 72, height: 72, borderRadius: 12 }} />
            </div>

            {/* Indeterminate progress bar */}
            <div style={{ width: 200, height: 2, background: "rgba(255,255,255,0.04)", borderRadius: 2, overflow: "hidden" }}>
                <div
                    style={{
                        width: "40%", height: "100%", borderRadius: 2,
                        background: "linear-gradient(90deg, transparent, #00d4aa, transparent)",
                        animation: "slideProgress 1.5s ease-in-out infinite",
                    }}
                />
            </div>

            {/* Status text */}
            <span style={{
                fontSize: 12, fontFamily: "JetBrains Mono, monospace",
                color: "#555", letterSpacing: "0.03em",
            }}>
                Connecting to Memba...
            </span>

            {/* Inline keyframes for the progress bar animation */}
            <style>{`
                @keyframes slideProgress {
                    0% { transform: translateX(-100%); }
                    100% { transform: translateX(350%); }
                }
            `}</style>
        </div>
    )
}
