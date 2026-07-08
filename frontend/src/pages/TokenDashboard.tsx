import { useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { useOutletContext } from "react-router-dom"
import { useNetworkNav } from "../hooks/useNetworkNav"
import { GNO_RPC_URL, GNO_CHAIN_ID } from "../lib/config"
import { listFactoryTokens, getTokenInfo, getTokenBalance, formatTokenAmount } from "../lib/grc20"
import { CopyableAddress } from "../components/ui/CopyableAddress"
import type { LayoutContext } from "../types/layout"
import "./tokendashboard.css"

export function TokenDashboard() {
    const navigate = useNetworkNav()
    const { auth, adena } = useOutletContext<LayoutContext>()

    // Token list (public — independent of the wallet). Cached + deduped by React
    // Query, so navigating back to /tokens no longer re-reads the whole list on
    // every mount; Refresh is an explicit refetch.
    const tokensQuery = useQuery({
        queryKey: ["tokens", "list", GNO_RPC_URL],
        queryFn: async () => {
            const list = await listFactoryTokens(GNO_RPC_URL)
            // Enrich every token in parallel (getTokenInfo per symbol).
            return Promise.all(list.map(async (t) => (await getTokenInfo(GNO_RPC_URL, t.symbol)) || t))
        },
        staleTime: 60_000,
    })
    const tokens = useMemo(() => tokensQuery.data ?? [], [tokensQuery.data])
    const loading = tokensQuery.isLoading

    // User balances (wallet-specific). Keyed on the address + the token set, so it
    // re-reads when the wallet or the list changes and is cached otherwise.
    const symbols = useMemo(() => tokens.map(t => t.symbol), [tokens])
    const balancesQuery = useQuery({
        queryKey: ["tokens", "balances", GNO_RPC_URL, adena.address, symbols],
        queryFn: async () => {
            const entries = await Promise.all(
                symbols.map(async (s) => [s, await getTokenBalance(GNO_RPC_URL, s, adena.address)] as const),
            )
            return Object.fromEntries(entries) as Record<string, bigint>
        },
        enabled: adena.connected && !!adena.address && symbols.length > 0,
        staleTime: 30_000,
    })
    const balances = balancesQuery.data ?? {}
    const balancesStale = balancesQuery.isError

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
                {/* Always shown — visitors need to discover token creation too.
                    /create-token gracefully prompts a wallet connect when needed. */}
                <button
                    className="k-btn-primary token-create-btn"
                    onClick={() => navigate("/create-token")}
                >
                    🪙 Create a Token
                </button>
            </div>

            {/* Stats bar */}
            <div className="token-stats-bar">
                <StatCard label="Total Tokens" value={String(tokens.length)} />
                <StatCard label="Network" value={GNO_CHAIN_ID} />
                {adena.connected && (
                    <StatCard
                        label={balancesStale ? "Your Holdings (stale)" : "Your Holdings"}
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
                    <button className="k-btn-primary" onClick={() => navigate("/create-token")}>
                        Create a Token
                    </button>
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
                                    <DetailLine label="Supply" value={formatTokenAmount(BigInt(token.totalSupply || "0"), token.decimals)} />
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
                                                {formatTokenAmount(bal, token.decimals)}
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
                    onClick={() => { void tokensQuery.refetch(); void balancesQuery.refetch() }}
                    disabled={tokensQuery.isFetching}
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
