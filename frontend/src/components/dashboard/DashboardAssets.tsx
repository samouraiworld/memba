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

    const fetchTokenBalances = useCallback(async () => {
        if (!address) return
        setLoading(true)
        setError(false)
        try {
            const factoryTokens = await listFactoryTokens(GNO_RPC_URL)
            const results: TokenBalance[] = []

            // Fetch balances in parallel (max 10 concurrent)
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

            setTokens(results)
        } catch {
            setError(true)
        } finally {
            setLoading(false)
        }
    }, [address])

    useEffect(() => { fetchTokenBalances() }, [fetchTokenBalances])

    // Format GNOT display — balance arrives as "19.3 GNOT" or "— GNOT"
    const gnotNum = gnotBalance ? parseFloat(gnotBalance) : NaN
    const gnotDisplay = !isNaN(gnotNum)
        ? gnotNum.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 })
        : "—"

    const totalAssets = tokens.length + (gnotBalance ? 1 : 0)

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
                    <span style={{ fontWeight: 600, fontSize: 13, color: "#f0f0f0" }}>Assets</span>
                    <span style={{
                        fontSize: 10, color: "#555",
                        fontFamily: "JetBrains Mono, monospace",
                    }}>
                        {loading ? "…" : `${totalAssets} token${totalAssets !== 1 ? "s" : ""}`}
                    </span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    {!collapsed && gnotBalance && (
                        <span style={{
                            fontSize: 12, fontWeight: 600, color: "#00d4aa",
                            fontFamily: "JetBrains Mono, monospace",
                        }}>
                            {gnotDisplay} GNOT
                        </span>
                    )}
                    <span style={{
                        fontSize: 10, color: "#555",
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
                                background: "#00d4aa", flexShrink: 0,
                            }} />
                            <span style={{ fontSize: 12, fontWeight: 600, color: "#e0e0e0" }}>GNOT</span>
                            <span style={{
                                fontSize: 9, color: "#444",
                                fontFamily: "JetBrains Mono, monospace",
                            }}>native</span>
                        </div>
                        <span style={{
                            fontSize: 12, fontWeight: 500, color: "#f0f0f0",
                            fontFamily: "JetBrains Mono, monospace",
                        }}>
                            {gnotDisplay}
                        </span>
                    </div>

                    {/* GRC20 token rows */}
                    {loading ? (
                        <div style={{ padding: "12px 20px" }}>
                            {[1, 2].map(i => (
                                <div key={i} className="k-shimmer" style={{
                                    height: 16, borderRadius: 4,
                                    background: "#111", marginBottom: 8,
                                    maxWidth: i === 1 ? "60%" : "40%",
                                }} />
                            ))}
                        </div>
                    ) : error ? (
                        <div style={{
                            padding: "10px 20px", fontSize: 10,
                            color: "#555", fontFamily: "JetBrains Mono, monospace",
                        }}>
                            GRC20 balances unavailable
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
                                        background: "#7c3aed", flexShrink: 0,
                                    }} />
                                    <span style={{ fontSize: 12, fontWeight: 600, color: "#e0e0e0" }}>
                                        {token.symbol}
                                    </span>
                                    <span style={{
                                        fontSize: 9, color: "#444",
                                        fontFamily: "JetBrains Mono, monospace",
                                    }}>
                                        {token.name}
                                    </span>
                                </div>
                                <span style={{
                                    fontSize: 12, fontWeight: 500, color: "#f0f0f0",
                                    fontFamily: "JetBrains Mono, monospace",
                                }}>
                                    {token.balance}
                                </span>
                            </div>
                        ))
                    ) : (
                        <div style={{
                            padding: "10px 20px", fontSize: 10,
                            color: "#444", fontFamily: "JetBrains Mono, monospace",
                        }}>
                            No GRC20 tokens held
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}
