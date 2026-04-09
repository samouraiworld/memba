/**
 * NotFound — 404 page for unmatched routes.
 */
import { useNetworkNav } from "../hooks/useNetworkNav"

export function NotFound() {
    const navigate = useNetworkNav()

    return (
        <div className="animate-fade-in" style={{
            display: "flex", flexDirection: "column", alignItems: "center",
            justifyContent: "center", gap: 24, padding: "80px 24px", textAlign: "center",
        }}>
            <div style={{
                fontSize: 72, fontWeight: 800, letterSpacing: "-0.04em",
                fontFamily: "JetBrains Mono, monospace",
                background: "linear-gradient(135deg, #00d4aa 0%, #00d4aa44 100%)",
                WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
                animation: "glitch 2s ease-in-out infinite",
            }}>
                404
            </div>
            <p style={{ color: "var(--color-text-secondary)", fontSize: 14, fontFamily: "JetBrains Mono, monospace", maxWidth: 400 }}>
                This page doesn't exist on the chain. Maybe it was never deployed, or you followed a broken link.
            </p>
            <div style={{ display: "flex", gap: 12 }}>
                <button
                    className="k-btn-primary"
                    onClick={() => navigate("/dashboard")}
                    style={{ fontSize: 12 }}
                >
                    ← Back to Dashboard
                </button>
                <button
                    className="k-btn-secondary"
                    onClick={() => navigate("/")}
                    style={{ fontSize: 12 }}
                >
                    Landing Page
                </button>
            </div>
            <style>{`
                @keyframes glitch {
                    0%, 100% { opacity: 1; transform: translate(0); }
                    20% { opacity: 0.8; transform: translate(-2px, 1px); }
                    40% { opacity: 1; transform: translate(1px, -1px); }
                    60% { opacity: 0.9; transform: translate(-1px, 2px); }
                    80% { opacity: 1; transform: translate(2px, -2px); }
                }
            `}</style>
        </div>
    )
}
