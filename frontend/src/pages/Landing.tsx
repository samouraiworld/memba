/**
 * Landing — public landing page for non-authenticated visitors.
 *
 * Showcases Memba features (Multisig, DAO, Token Factory) and prompts
 * wallet connection. Moved from the Dashboard logged-out section in v2.0.0
 * for clean separation of public vs authenticated content.
 */
import { useNavigate, useOutletContext, Navigate } from "react-router-dom"
import type { LayoutContext } from "../types/layout"

export function Landing() {
    const navigate = useNavigate()
    const { adena } = useOutletContext<LayoutContext>()

    // N1: Redirect connected users to Dashboard
    if (adena.connected) {
        return <Navigate to="/dashboard" replace />
    }

    return (
        <div className="animate-fade-in" style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            {/* Hero */}
            <div style={{ textAlign: "center", padding: "32px 16px 16px" }}>
                <h3 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8, letterSpacing: "-0.02em" }}>
                    Welcome to Memba <span style={{ color: "#666", fontWeight: 400 }}>メンバー</span>
                </h3>
                <p style={{ color: "#888", fontSize: 13, maxWidth: 480, margin: "0 auto", fontFamily: "JetBrains Mono, monospace", lineHeight: 1.7 }}>
                    Your gateway to Gno multisig wallets, DAO governance, and token management — all in one place.
                </p>
            </div>
            {/* CTA — above feature cards */}
            <div style={{ textAlign: "center", padding: "0 0 8px" }}>
                {adena.installed ? (
                    <button
                        onClick={() => adena.connect()}
                        style={{
                            color: "#00d4aa", fontSize: 12, fontFamily: "JetBrains Mono, monospace",
                            background: "none", border: "1px solid rgba(0,212,170,0.25)",
                            padding: "8px 20px", borderRadius: 6, cursor: "pointer",
                            transition: "all 0.15s",
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background = "rgba(0,212,170,0.08)"; e.currentTarget.style.borderColor = "rgba(0,212,170,0.5)" }}
                        onMouseLeave={e => { e.currentTarget.style.background = "none"; e.currentTarget.style.borderColor = "rgba(0,212,170,0.25)" }}
                    >
                        Connect your Adena wallet to get started →
                    </button>
                ) : (
                    <a
                        href="https://adena.app"
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                            color: "#00d4aa", fontSize: 12, fontFamily: "JetBrains Mono, monospace",
                            textDecoration: "none", border: "1px solid rgba(0,212,170,0.25)",
                            padding: "8px 20px", borderRadius: 6, display: "inline-block",
                            transition: "all 0.15s",
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background = "rgba(0,212,170,0.08)"; e.currentTarget.style.borderColor = "rgba(0,212,170,0.5)" }}
                        onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.borderColor = "rgba(0,212,170,0.25)" }}
                    >
                        Install Adena wallet to get started →
                    </a>
                )}
            </div>
            {/* Feature Showcase Cards — clickable */}
            <div className="k-feature-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16 }}>
                {[
                    {
                        icon: "🔐", title: "Multisig Wallets", href: "/multisig",
                        bullets: ["Create shared wallets with threshold signing (K-of-N)", "Air-gapped gnokey support for maximum security", "Import & share multisig configurations"],
                    },
                    {
                        icon: "🏛️", title: "DAO Governance", href: "/dao",
                        bullets: ["Browse & vote on DAO proposals", "Create your own DAO with custom roles & tiers", "Treasury management & member control"],
                    },
                    {
                        icon: "🪙", title: "Token Factory", href: "/tokens",
                        bullets: ["Deploy GRC20 tokens on gno.land", "Configure decimals, initial mint & faucet", "Multisig-governed token administration"],
                    },
                ].map(f => (
                    <div
                        key={f.title}
                        className="k-card"
                        onClick={() => adena.connected ? navigate(f.href) : adena.connect()}
                        style={{
                            padding: "24px 20px", display: "flex", flexDirection: "column", gap: 16,
                            borderColor: "#222", cursor: "pointer", transition: "border-color 0.15s, transform 0.15s",
                        }}
                        onMouseEnter={e => { e.currentTarget.style.borderColor = "rgba(0,212,170,0.3)"; e.currentTarget.style.transform = "translateY(-2px)" }}
                        onMouseLeave={e => { e.currentTarget.style.borderColor = "#222"; e.currentTarget.style.transform = "translateY(0)" }}
                    >
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <span style={{ fontSize: 28 }}>{f.icon}</span>
                            <span style={{ fontSize: 15, fontWeight: 600 }}>{f.title}</span>
                        </div>
                        <ul style={{ margin: 0, paddingLeft: 18, listStyle: "none" }}>
                            {f.bullets.map((b, i) => (
                                <li key={i} style={{ color: "#888", fontSize: 12, fontFamily: "JetBrains Mono, monospace", lineHeight: 1.8, position: "relative", paddingLeft: 4 }}>
                                    <span style={{ position: "absolute", left: -14, color: "#00d4aa" }}>·</span>
                                    {b}
                                </li>
                            ))}
                        </ul>
                        <span style={{ fontSize: 10, fontFamily: "JetBrains Mono, monospace", color: "#00d4aa", alignSelf: "flex-end" }}>
                            Explore →
                        </span>
                    </div>
                ))}
            </div>
            {/* Single gno.land tag — below grid */}
            <div style={{ textAlign: "center", padding: "8px 0 0" }}>
                <span style={{
                    fontSize: 10, fontFamily: "JetBrains Mono, monospace",
                    color: "#00d4aa", background: "rgba(0,212,170,0.06)",
                    padding: "3px 10px", borderRadius: 4,
                    border: "1px solid rgba(0,212,170,0.12)",
                }}>
                    Built on gno.land — the smart contract platform
                </span>
            </div>
        </div>
    )
}
