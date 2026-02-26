import { useState, useEffect, useCallback } from "react"
import { useNavigate, useOutletContext } from "react-router-dom"
import { GNO_RPC_URL, GNO_CHAIN_ID } from "../lib/config"
import { listFactoryTokens, getTokenInfo, getTokenBalance, type TokenInfo } from "../lib/grc20"
import { CopyableAddress } from "../components/ui/CopyableAddress"
import type { LayoutContext } from "../types/layout"

export function TokenDashboard() {
    const navigate = useNavigate()
    const { auth, adena } = useOutletContext<LayoutContext>()

    const [tokens, setTokens] = useState<TokenInfo[]>([])
    const [balances, setBalances] = useState<Record<string, bigint>>({})
    const [loading, setLoading] = useState(true)

    const fetchTokens = useCallback(async () => {
        setLoading(true)
        try {
            // List all factory tokens
            const list = await listFactoryTokens(GNO_RPC_URL)

            // Enrich each with full info
            const enriched: TokenInfo[] = []
            for (const t of list) {
                const info = await getTokenInfo(GNO_RPC_URL, t.symbol)
                enriched.push(info || t)
            }
            setTokens(enriched)

            // Fetch user balances if connected
            if (adena.connected && adena.address) {
                const bals: Record<string, bigint> = {}
                for (const t of enriched) {
                    bals[t.symbol] = await getTokenBalance(GNO_RPC_URL, t.symbol, adena.address)
                }
                setBalances(bals)
            }
        } catch (err) {
            console.error("Failed to fetch tokens:", err)
        } finally {
            setLoading(false)
        }
    }, [adena.connected, adena.address])

    useEffect(() => {
        fetchTokens()
    }, [fetchTokens])

    return (
        <div className="animate-fade-in" style={{ display: "flex", flexDirection: "column", gap: 32 }}>
            {/* Header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
                <div>
                    <button onClick={() => navigate("/")} style={backStyle}>
                        ← Dashboard
                    </button>
                    <h2 style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em" }}>
                        GRC20 Tokens
                    </h2>
                    <p style={{ color: "#666", fontSize: 12, marginTop: 4, fontFamily: "JetBrains Mono, monospace" }}>
                        Tokens on {GNO_CHAIN_ID} via grc20factory
                    </p>
                </div>
                {auth.isAuthenticated && (
                    <button
                        className="k-btn-primary"
                        onClick={() => navigate("/create-token")}
                        style={{ fontSize: 12, whiteSpace: "nowrap" }}
                    >
                        🪙 Create a Token
                    </button>
                )}
            </div>

            {/* Stats bar */}
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <StatCard label="Total Tokens" value={String(tokens.length)} />
                <StatCard label="Network" value={GNO_CHAIN_ID} />
                {adena.connected && (
                    <StatCard
                        label="Your Holdings"
                        value={String(Object.values(balances).filter(b => b > 0n).length)}
                    />
                )}
            </div>

            {/* Token Grid */}
            {loading ? (
                <div className="k-card" style={{ textAlign: "center", padding: 48 }}>
                    <p style={{ color: "#555", fontSize: 14, fontFamily: "JetBrains Mono, monospace" }}>
                        Loading tokens...
                    </p>
                </div>
            ) : tokens.length === 0 ? (
                <div className="k-dashed" style={{ background: "#0c0c0c", padding: 48, textAlign: "center" }}>
                    <div style={{ width: 48, height: 48, borderRadius: 12, background: "rgba(245,166,35,0.06)", border: "1px dashed rgba(245,166,35,0.3)", display: "inline-flex", alignItems: "center", justifyContent: "center", marginBottom: 16 }}>
                        <span style={{ fontSize: 24 }}>🪙</span>
                    </div>
                    <h3 style={{ fontSize: 16, fontWeight: 500, marginBottom: 8 }}>No tokens yet</h3>
                    <p style={{ color: "#666", fontSize: 13, maxWidth: 360, margin: "0 auto 20px", fontFamily: "JetBrains Mono, monospace" }}>
                        Be the first to create a GRC20 token on {GNO_CHAIN_ID}
                    </p>
                    {auth.isAuthenticated && (
                        <button className="k-btn-primary" onClick={() => navigate("/create-token")}>
                            Create a Token
                        </button>
                    )}
                </div>
            ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12 }}>
                    {tokens.map(token => {
                        const bal = balances[token.symbol] || 0n
                        const isAdmin = auth.isAuthenticated && token.admin && adena.address && token.admin === adena.address
                        return (
                            <div
                                key={token.symbol}
                                className="k-card"
                                onClick={() => navigate(`/tokens/${token.symbol}`)}
                                style={{ cursor: "pointer", transition: "border-color 0.15s" }}
                                onMouseEnter={e => e.currentTarget.style.borderColor = "rgba(245,166,35,0.3)"}
                                onMouseLeave={e => e.currentTarget.style.borderColor = ""}
                            >
                                {/* Header */}
                                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                        <span style={{ fontSize: 20 }}>🪙</span>
                                        <div>
                                            <span style={{ fontWeight: 600, fontSize: 14 }}>{token.name}</span>
                                            <span style={{ marginLeft: 6, fontSize: 11, color: "#888", fontFamily: "JetBrains Mono, monospace" }}>
                                                ${token.symbol}
                                            </span>
                                        </div>
                                    </div>
                                    {isAdmin && (
                                        <span style={{ fontSize: 10, fontFamily: "JetBrains Mono, monospace", color: "#00d4aa", background: "rgba(0,212,170,0.08)", padding: "2px 6px", borderRadius: 4 }}>
                                            Admin
                                        </span>
                                    )}
                                </div>

                                {/* Details */}
                                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                                    <DetailLine label="Supply" value={token.totalSupply} />
                                    <DetailLine label="Decimals" value={String(token.decimals)} />
                                    {token.admin && (
                                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, fontFamily: "JetBrains Mono, monospace" }}>
                                            <span style={{ color: "#666" }}>Admin</span>
                                            <CopyableAddress address={token.admin} full={false} fontSize={11} />
                                        </div>
                                    )}
                                    {adena.connected && (
                                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, fontFamily: "JetBrains Mono, monospace" }}>
                                            <span style={{ color: "#666" }}>Your Balance</span>
                                            <span style={{ color: bal > 0n ? "#00d4aa" : "#555" }}>
                                                {String(bal)}
                                            </span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )
                    })}
                </div>
            )}

            {/* Refresh */}
            <div style={{ textAlign: "center" }}>
                <button
                    onClick={fetchTokens}
                    disabled={loading}
                    style={{ ...backStyle, fontSize: 11, opacity: loading ? 0.5 : 1 }}
                >
                    ↻ Refresh
                </button>
            </div>
        </div>
    )
}

// ── Sub-components ────────────────────────────────────────────

function StatCard({ label, value }: { label: string; value: string }) {
    return (
        <div className="k-card" style={{ flex: "1 1 100px", padding: "12px 16px", textAlign: "center" }}>
            <p style={{ fontSize: 18, fontWeight: 600, color: "#f0f0f0" }}>{value}</p>
            <p style={{ fontSize: 10, fontFamily: "JetBrains Mono, monospace", color: "#666", marginTop: 2, textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</p>
        </div>
    )
}

function DetailLine({ label, value }: { label: string; value: string }) {
    return (
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, fontFamily: "JetBrains Mono, monospace" }}>
            <span style={{ color: "#666" }}>{label}</span>
            <span style={{ color: "#aaa" }}>{value}</span>
        </div>
    )
}

// ── Styles ────────────────────────────────────────────────────

const backStyle: React.CSSProperties = {
    color: "#00d4aa", fontSize: 13, background: "none", border: "none",
    cursor: "pointer", marginBottom: 16, fontFamily: "JetBrains Mono, monospace",
}
