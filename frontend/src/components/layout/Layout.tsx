import { Outlet } from "react-router-dom"
import { useAdena } from "../../hooks/useAdena"
import { useBalance } from "../../hooks/useBalance"

export function Layout() {
    const adena = useAdena()
    const { balance } = useBalance(adena.connected ? adena.address : null)

    const truncateAddr = (addr: string) =>
        addr.length > 16 ? `${addr.slice(0, 8)}...${addr.slice(-6)}` : addr

    return (
        <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", background: "#000", color: "#f0f0f0" }}>
            {/* ── Header ──────────────────────────────────────────────── */}
            <header className="k-glass" style={{ position: "sticky", top: 0, zIndex: 50, borderBottom: "1px solid #1a1a1a" }}>
                <div style={{ maxWidth: 1152, margin: "0 auto", padding: "0 24px", height: 64, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    {/* Logo */}
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <div
                            className="animate-glow"
                            style={{
                                width: 36, height: 36, borderRadius: 8,
                                border: "1px dashed rgba(0,212,170,0.35)",
                                background: "rgba(0,212,170,0.06)",
                                display: "flex", alignItems: "center", justifyContent: "center",
                            }}
                        >
                            <span style={{ color: "#00d4aa", fontFamily: "JetBrains Mono, monospace", fontSize: 14, fontWeight: 700 }}>M</span>
                        </div>
                        <span style={{ fontWeight: 600, fontSize: 18, letterSpacing: "-0.03em" }}>Memba</span>
                        <span style={{
                            fontSize: 10, fontFamily: "JetBrains Mono, monospace",
                            color: "#00d4aa", background: "rgba(0,212,170,0.08)",
                            padding: "2px 6px", borderRadius: 4, letterSpacing: "0.05em",
                        }}>MVP</span>
                    </div>

                    {/* Right side */}
                    <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                        {adena.connected ? (
                            <>
                                <span style={{ fontSize: 12, fontFamily: "JetBrains Mono, monospace", color: "#888" }}>
                                    {balance}
                                </span>
                                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#00d4aa" }} className="animate-glow" />
                                    <span style={{ fontSize: 12, fontFamily: "JetBrains Mono, monospace", color: "#ccc" }}>
                                        {truncateAddr(adena.address)}
                                    </span>
                                </div>
                                <button
                                    onClick={adena.disconnect}
                                    style={{
                                        padding: "6px 12px", borderRadius: 6,
                                        background: "none", border: "1px solid #333",
                                        color: "#888", fontSize: 11, cursor: "pointer",
                                        fontFamily: "JetBrains Mono, monospace",
                                    }}
                                >
                                    Disconnect
                                </button>
                            </>
                        ) : (
                            adena.isInstalled() ? (
                                <button className="k-btn-wallet" onClick={adena.connect} disabled={adena.loading}>
                                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: adena.loading ? "#555" : "#00d4aa" }} />
                                    {adena.loading ? "Connecting..." : "Connect Wallet"}
                                </button>
                            ) : (
                                <a
                                    href="https://adena.app"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="k-btn-wallet"
                                    style={{ textDecoration: "none" }}
                                >
                                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#f59e0b" }} />
                                    Install Adena
                                </a>
                            )
                        )}
                    </div>
                </div>
            </header>

            {/* ── Main ────────────────────────────────────────────────── */}
            <main style={{ flex: 1, maxWidth: 1152, margin: "0 auto", padding: "32px 24px", width: "100%" }}>
                <Outlet context={{ adena, balance }} />
            </main>

            {/* ── Footer ──────────────────────────────────────────────── */}
            <footer style={{ borderTop: "1px solid #111", padding: "16px 24px", textAlign: "center" }}>
                <p style={{ color: "#333", fontSize: 11, fontFamily: "JetBrains Mono, monospace" }}>
                    memba v0.1.0 • built by samourai coop
                </p>
            </footer>
        </div>
    )
}
