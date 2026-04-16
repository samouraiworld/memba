/**
 * ConnectingLoader — Unified Memba loading state.
 *
 * Used for:
 * - Wallet connect → auth flow gap (Dashboard, ProfilePage)
 * - Route-level lazy loading fallback (App.tsx PageLoader replacement)
 *
 * v2.10: Logo increased 72px → 94px (+30%), added `message` and `minHeight` props.
 */

interface ConnectingLoaderProps {
    /** Status text below the progress bar. */
    message?: string
    /** Minimum viewport height for centering. Default: "60vh". Use "30vh" for route fallbacks. */
    minHeight?: string
}

export function ConnectingLoader({ message = "Connecting to Memba...", minHeight = "60vh" }: ConnectingLoaderProps) {
    return (
        <div
            role="status"
            aria-live="polite"
            style={{
                display: "flex", flexDirection: "column", alignItems: "center",
                justifyContent: "center", minHeight, gap: 24, animation: "fadeIn 0.3s ease-out",
            }}
        >
            {/* Memba logo with pulse — v2.10: 72px → 94px (+30%) */}
            <div
                className="animate-glow"
                style={{
                    width: 104, height: 104, borderRadius: 20,
                    display: "flex", alignItems: "center", justifyContent: "center",
                }}
            >
                <img src="/memba-icon.png" alt="Memba" style={{ width: 94, height: 94, borderRadius: 16 }} />
            </div>

            {/* Indeterminate progress bar */}
            <div style={{ width: 200, height: 2, background: "rgba(255,255,255,0.04)", borderRadius: 2, overflow: "hidden" }}>
                <div
                    style={{
                        width: "40%", height: "100%", borderRadius: 2,
                        background: "linear-gradient(90deg, transparent, var(--color-k-accent), transparent)",
                        animation: "slideProgress 1.5s ease-in-out infinite",
                    }}
                />
            </div>

            {/* Status text */}
            <span style={{
                fontSize: 12, fontFamily: "JetBrains Mono, monospace",
                color: "var(--color-text-muted)", letterSpacing: "0.03em",
            }}>
                {message}
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
