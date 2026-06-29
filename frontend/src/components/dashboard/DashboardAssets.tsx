/**
 * DashboardAssets — Compact, collapsible token balance overview card.
 *
 * Shows GNOT balance (passed from parent) + all GRC20 tokens with non-zero balance.
 * Collapse state is persisted via localStorage.
 *
 * @module components/dashboard/DashboardAssets
 */

import { useState, useEffect, useCallback } from "react"
import { listFactoryTokens, getTokenBalance, getTokenInfo, formatTokenAmount } from "../../lib/grc20"
import { fetchCollectionList } from "../../lib/launchpadReads"
import { NFT_COLLECTIONS_PATH } from "../../lib/nftConfig"
import { GNO_RPC_URL } from "../../lib/config"

interface DashboardAssetsProps {
    address: string
    gnotBalance: string | null
}

interface TokenBalance {
    symbol: string
    name: string
    balance: string
    decimals: number
    isNft?: boolean
}

const COLLAPSE_KEY = "memba_assets_collapsed"

export function DashboardAssets({ address, gnotBalance }: DashboardAssetsProps) {
    const [collapsed, setCollapsed] = useState(() => {
        try { return localStorage.getItem(COLLAPSE_KEY) === "1" } catch { return false }
    })
    const [tokens, setTokens] = useState<TokenBalance[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(false)

    const toggleCollapse = () => {
        const next = !collapsed
        setCollapsed(next)
        try { localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0") } catch { /* */ }
    }

    const fetchBalances = useCallback(async () => {
        if (!address) return
        setLoading(true)
        setError(false)
        try {
            const [factoryTokens, collections] = await Promise.all([
                listFactoryTokens(GNO_RPC_URL).catch(() => []),
                fetchCollectionList(GNO_RPC_URL, NFT_COLLECTIONS_PATH).catch(() => []),
            ])
            
            const results: TokenBalance[] = []

            // 1. Fetch GRC20 Token Balances
            const batches: typeof factoryTokens[] = []
            for (let i = 0; i < factoryTokens.length; i += 10) {
                batches.push(factoryTokens.slice(i, i + 10))
            }

            for (const batch of batches) {
                const balances = await Promise.all(
                    batch.map(async (token) => {
                        try {
                            const [bal, info] = await Promise.all([
                                getTokenBalance(GNO_RPC_URL, token.symbol, address),
                                getTokenInfo(GNO_RPC_URL, token.symbol),
                            ])
                            if (bal > 0n) {
                                const decimals = info?.decimals || 0
                                const formatted = formatTokenAmount(bal, decimals)
                                return {
                                    symbol: token.symbol,
                                    name: info?.name || token.name,
                                    balance: formatted,
                                    decimals,
                                }
                            }
                            return null
                        } catch {
                            return null
                        }
                    })
                )
                results.push(...balances.filter((b): b is TokenBalance => b !== null))
            }

            // 2. Fetch GRC721 NFT Balances
            const nftBatches: typeof collections[] = []
            for (let i = 0; i < collections.length; i += 10) {
                nftBatches.push(collections.slice(i, i + 10))
            }

            for (const batch of nftBatches) {
                const { getNFTBalance } = await import("../../lib/grc721")
                const balances = await Promise.all(
                    batch.map(async (col) => {
                        try {
                            const bal = await getNFTBalance(NFT_COLLECTIONS_PATH, col.id, address)
                            if (bal > 0) {
                                return {
                                    symbol: "NFT",
                                    name: col.name,
                                    balance: bal.toString(),
                                    decimals: 0,
                                    isNft: true
                                }
                            }
                            return null
                        } catch {
                            return null
                        }
                    })
                )
                results.push(...balances.filter((b): b is TokenBalance => b !== null))
            }

            setTokens(results)
        } catch {
            setError(true)
        } finally {
            setLoading(false)
        }
    }, [address])

    useEffect(() => { fetchBalances() }, [fetchBalances])

    const gnotNum = gnotBalance ? parseFloat(gnotBalance) : NaN
    const gnotDisplay = !isNaN(gnotNum)
        ? gnotNum.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 })
        : "—"

    const totalAssets = tokens.length + (gnotBalance ? 1 : 0)

    if (loading && tokens.length === 0) {
        return (
            <div className="db-assets-skeleton">
                <div className="skeleton-bar" style={{ width: "40%", marginBottom: "1rem" }} />
                <div className="skeleton-bar" style={{ width: "100%", height: "48px", marginBottom: "8px" }} />
                <div className="skeleton-bar" style={{ width: "100%", height: "48px" }} />
            </div>
        )
    }

    if (error && tokens.length === 0) {
        return (
            <div className="k-card" style={{ padding: "16px" }}>
                <p style={{ color: "var(--color-error)", fontSize: "14px" }}>Failed to load wallet assets.</p>
                <button className="k-btn-secondary" onClick={fetchBalances} style={{ marginTop: "8px", padding: "4px 12px", fontSize: "12px" }}>
                    Retry
                </button>
            </div>
        )
    }

    if (totalAssets === 0) return null

    return (
        <div className="k-card" style={{ padding: 0, overflow: "hidden" }}>
            {/* Header — always visible */}
            <button
                id="assets-toggle"
                onClick={toggleCollapse}
                style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    width: "100%", padding: "14px 20px",
                    background: "transparent", border: "none", cursor: "pointer",
                    transition: "background 0.15s",
                }}
                onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.02)"}
                onMouseLeave={e => e.currentTarget.style.background = "transparent"}
            >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 14 }}>💰</span>
                    <span style={{ fontWeight: 600, fontSize: 13, color: "var(--color-text)" }}>Assets</span>
                    <span style={{
                        fontSize: 10, color: "var(--color-text-muted)",
                        fontFamily: "JetBrains Mono, monospace",
                    }}>
                        {loading ? "…" : `${totalAssets} token${totalAssets !== 1 ? "s" : ""}`}
                    </span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    {!collapsed && gnotBalance && (
                        <span style={{
                            fontSize: 12, fontWeight: 600, color: "var(--color-primary)",
                            fontFamily: "JetBrains Mono, monospace",
                        }}>
                            {gnotDisplay} GNOT
                        </span>
                    )}
                    <span style={{
                        fontSize: 10, color: "var(--color-text-muted)",
                        transition: "transform 0.2s",
                        transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)",
                        display: "inline-block",
                    }}>
                        ▾
                    </span>
                </div>
            </button>

            {/* Body — collapsible */}
            {!collapsed && (
                <div style={{
                    borderTop: "1px solid rgba(255,255,255,0.04)",
                    animation: "fadeIn 0.15s ease",
                }}>
                    {/* GNOT row */}
                    <div style={{
                        display: "flex", alignItems: "center", justifyContent: "space-between",
                        padding: "10px 20px",
                        borderBottom: "1px solid rgba(255,255,255,0.02)",
                    }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <span style={{
                                width: 6, height: 6, borderRadius: "50%",
                                background: "var(--color-brand)", flexShrink: 0,
                            }} />
                            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--color-text)" }}>GNOT</span>
                            <span style={{
                                fontSize: 9, color: "var(--color-text-dim)",
                                fontFamily: "JetBrains Mono, monospace",
                            }}>native</span>
                        </div>
                        <span style={{
                            fontSize: 12, fontWeight: 500, color: "var(--color-text)",
                            fontFamily: "JetBrains Mono, monospace",
                        }}>
                            {gnotDisplay}
                        </span>
                    </div>

                    {/* Extracted Tokens (GRC20 & GRC721) */}
                    {loading ? (
                        <div style={{ padding: "12px 20px" }}>
                            {[1, 2].map(i => (
                                <div key={i} className="k-shimmer" style={{
                                    height: 16, borderRadius: 4,
                                    background: "var(--color-border)", marginBottom: 8,
                                    maxWidth: i === 1 ? "60%" : "40%",
                                }} />
                            ))}
                        </div>
                    ) : error ? (
                        <div style={{
                            padding: "10px 20px", fontSize: 10,
                            color: "var(--color-text-muted)", fontFamily: "JetBrains Mono, monospace",
                        }}>
                            Asset balances unavailable
                        </div>
                    ) : tokens.length > 0 ? (
                        tokens.map(token => (
                            <div key={token.symbol} style={{
                                display: "flex", alignItems: "center", justifyContent: "space-between",
                                padding: "10px 20px",
                                borderBottom: "1px solid rgba(255,255,255,0.02)",
                            }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                    <span style={{
                                        width: 6, height: 6, borderRadius: "50%",
                                        background: token.isNft ? "var(--color-accent-teal)" : "var(--color-accent-purple-deep)", flexShrink: 0,
                                    }} />
                                    <span style={{ fontSize: 12, fontWeight: 600, color: "var(--color-text)" }}>
                                        {token.isNft ? "NFT" : token.symbol}
                                    </span>
                                    <span style={{
                                        fontSize: 9, color: "var(--color-text-dim)",
                                        fontFamily: "JetBrains Mono, monospace",
                                    }}>
                                        {token.name}
                                    </span>
                                </div>
                                <span style={{
                                    fontSize: 12, fontWeight: 500, color: "var(--color-text)",
                                    fontFamily: "JetBrains Mono, monospace",
                                }}>
                                    {token.balance}
                                    {token.isNft && <span style={{ fontSize: "10px", color: "var(--color-text-tertiary)", marginLeft: "4px" }}>items</span>}
                                </span>
                            </div>
                        ))
                    ) : (
                        <div style={{
                            padding: "10px 20px", fontSize: 10,
                            color: "var(--color-text-dim)", fontFamily: "JetBrains Mono, monospace",
                        }}>
                            No custom tokens or NFTs held
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}
