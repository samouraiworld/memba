import { useState, useEffect, useCallback } from "react"
import { useOutletContext } from "react-router-dom"
import { useNetworkNav } from "../hooks/useNetworkNav"
import { GNO_RPC_URL, GNO_CHAIN_ID } from "../lib/config"
import { listFactoryTokens, getTokenInfo, getTokenBalance, type TokenInfo } from "../lib/grc20"
import { CopyableAddress } from "../components/ui/CopyableAddress"
import type { LayoutContext } from "../types/layout"
import "./tokendashboard.css"

export function TokenDashboard() {
    const navigate = useNetworkNav()
    const { auth, adena } = useOutletContext<LayoutContext>()

    const [tokens, setTokens] = useState<TokenInfo[]>([])
    const [balances, setBalances] = useState<Record<string, bigint>>({})
    const [loading, setLoading] = useState(true)

    // Fetch token list (public data — independent of wallet connection)
    const fetchTokenList = useCallback(async () => {
        setLoading(true)
        try {
            // List all factory tokens
            const list = await listFactoryTokens(GNO_RPC_URL)

            // Enrich all tokens in parallel (was sequential N+1)
            const enriched = await Promise.all(
                list.map(async (t) => {
                    const info = await getTokenInfo(GNO_RPC_URL, t.symbol)
                    return info || t
                })
            )
            setTokens(enriched)
        } catch (err) {
            console.error("Failed to fetch tokens:", err)
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        fetchTokenList()
    }, [fetchTokenList])

    // Fetch user balances (wallet-specific — runs when wallet connects or token list loads)
    useEffect(() => {
        if (!adena.connected || !adena.address || tokens.length === 0) return
        Promise.all(
            tokens.map(async (t) => {
                const bal = await getTokenBalance(GNO_RPC_URL, t.symbol, adena.address)
                return [t.symbol, bal] as const
            })
        )
            .then(entries => setBalances(Object.fromEntries(entries)))
            .catch(() => { /* non-blocking */ })
    }, [tokens, adena.connected, adena.address])

    return (
        <div className="animate-fade-in token-dashboard">
            {/* Header */}
            <div className="token-header">
                <div>
                    <button onClick={() => navigate("/")} className="token-back-btn">
                        ← Dashboard
                    </button>
                    <h2 className="token-title">
                        GRC20 Tokens
                    </h2>
                    <p className="token-subtitle">
                        Tokens on {GNO_CHAIN_ID} via grc20factory
                    </p>
                </div>
                {auth.isAuthenticated && (
                    <button
                        className="k-btn-primary token-create-btn"
                        onClick={() => navigate("/create-token")}
                    >
                        🪙 Create a Token
                    </button>
                )}
            </div>

            {/* Stats bar */}
            <div className="token-stats-bar">
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
                <div className="k-card token-loading">
                    <p>Loading tokens...</p>
                </div>
            ) : tokens.length === 0 ? (
                <div className="k-dashed token-empty">
                    <div className="token-empty-icon">
                        <span style={{ fontSize: 24 }}>🪙</span>
                    </div>
                    <h3 className="token-empty-title">No tokens yet</h3>
                    <p className="token-empty-desc">
                        Be the first to create a GRC20 token on {GNO_CHAIN_ID}
                    </p>
                    {auth.isAuthenticated && (
                        <button className="k-btn-primary" onClick={() => navigate("/create-token")}>
                            Create a Token
                        </button>
                    )}
                </div>
            ) : (
                <div className="token-grid">
                    {tokens.map(token => {
                        const bal = balances[token.symbol] || 0n
                        const isAdmin = auth.isAuthenticated && token.admin && adena.address && token.admin === adena.address
                        return (
                            <div
                                key={token.symbol}
                                className="k-card token-card"
                                onClick={() => navigate(`/tokens/${token.symbol}`)}
                            >
                                {/* Header */}
                                <div className="token-card-header">
                                    <div className="token-card-identity">
                                        <span className="token-card-icon">🪙</span>
                                        <div>
                                            <span className="token-card-name">{token.name}</span>
                                            <span className="token-card-symbol">
                                                ${token.symbol}
                                            </span>
                                        </div>
                                    </div>
                                    {isAdmin && (
                                        <span className="token-admin-badge">
                                            Admin
                                        </span>
                                    )}
                                </div>

                                {/* Details */}
                                <div className="token-detail-list">
                                    <DetailLine label="Supply" value={token.totalSupply} />
                                    <DetailLine label="Decimals" value={String(token.decimals)} />
                                    {token.admin && (
                                        <div className="token-detail-row">
                                            <span className="token-detail-label">Admin</span>
                                            <CopyableAddress address={token.admin} full={false} fontSize={11} />
                                        </div>
                                    )}
                                    {adena.connected && (
                                        <div className="token-detail-row">
                                            <span className="token-detail-label">Your Balance</span>
                                            <span className={bal > 0n ? "token-balance-positive" : "token-balance-zero"}>
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
            <div className="token-refresh-row">
                <button
                    onClick={fetchTokenList}
                    disabled={loading}
                    className="token-refresh-btn"
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
        <div className="k-card token-stat-card">
            <p className="token-stat-value">{value}</p>
            <p className="token-stat-label">{label}</p>
        </div>
    )
}

function DetailLine({ label, value }: { label: string; value: string }) {
    return (
        <div className="token-detail-row">
            <span className="token-detail-label">{label}</span>
            <span className="token-detail-value">{value}</span>
        </div>
    )
}
