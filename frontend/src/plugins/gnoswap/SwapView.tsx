/**
 * SwapView — GnoSwap DEX integration UI for DAO treasuries.
 *
 * Views:
 * 1. Pool list — available liquidity pools with TVL
 * 2. Swap form — token pair, amount, slippage control
 * 3. Add Liquidity form — token pair, amounts, price range
 *
 * All swap/liquidity operations are governance proposals, not direct execution.
 *
 * @module plugins/gnoswap/SwapView
 */

import { useState, useEffect, useCallback } from "react"
import type { PluginProps } from "../types"
import { getPoolList } from "./queries"
import type { SwapPool } from "./queries"
import { buildSwapRouteMsg, validateSlippage, isSlippageWarning, calculateMinOutput, DEFAULT_SLIPPAGE } from "./builders"
import { doContractBroadcast } from "../../lib/grc20"
import { GNO_RPC_URL, getGnoSwapPaths } from "../../lib/config"

type View = "pools" | "swap" | "liquidity"

export default function SwapView({ auth, adena }: PluginProps) {
    const paths = getGnoSwapPaths()

    const [view, setView] = useState<View>("pools")
    const [pools, setPools] = useState<SwapPool[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    // Swap form
    const [tokenIn, setTokenIn] = useState("")
    const [tokenOut, setTokenOut] = useState("")
    const [amountIn, setAmountIn] = useState("")
    const [slippage, setSlippage] = useState(DEFAULT_SLIPPAGE)
    const [posting, setPosting] = useState(false)

    const loadPools = useCallback(async () => {
        if (!paths) return
        setLoading(true)
        setError(null)
        try {
            const p = await getPoolList(GNO_RPC_URL, paths)
            setPools(p)
        } catch {
            setError("Failed to load pools")
        } finally {
            setLoading(false)
        }
    }, [paths])

    useEffect(() => {
        if (view === "pools") loadPools()
    }, [view, loadPools])

    // ── Swap Action ─────────────────────────────────────────────

    const handleSwap = async () => {
        if (!auth.isAuthenticated || !adena.address || !paths) return
        if (!tokenIn || !tokenOut || !amountIn) { setError("Fill all fields"); return }

        // BT-M1: Validate token path format
        const realmPathPattern = /^gno\.land\/r\/[a-z0-9_/]+$/
        if (!realmPathPattern.test(tokenIn)) { setError("Invalid token-in path — must be gno.land/r/..."); return }
        if (!realmPathPattern.test(tokenOut)) { setError("Invalid token-out path — must be gno.land/r/..."); return }

        const slippageError = validateSlippage(slippage)
        if (slippageError) { setError(slippageError); return }

        const pool = pools.find(p => (p.token0 === tokenIn && p.token1 === tokenOut) || (p.token0 === tokenOut && p.token1 === tokenIn))
        const route = pool?.path || `${tokenIn}_${tokenOut}_3000`
        const minOut = calculateMinOutput(amountIn, slippage)

        // BT-L1: Warn if minOutput is 0
        if (minOut === "0") { setError("Amount too small — minimum output would be 0"); return }

        setPosting(true)
        setError(null)
        try {
            const msg = buildSwapRouteMsg(adena.address, paths, tokenIn, tokenOut, amountIn, minOut, route)
            await doContractBroadcast([msg], `Swap ${tokenIn} → ${tokenOut}`)
            setAmountIn("")
            setView("pools")
        } catch (err) {
            setError(err instanceof Error ? err.message : "Swap failed")
        } finally {
            setPosting(false)
        }
    }

    // ── Styles ────────────────────────────────────────────────────

    const cardStyle: React.CSSProperties = {
        padding: "16px 20px",
        borderRadius: 10,
        background: "rgba(255,255,255,0.02)",
        border: "1px solid rgba(255,255,255,0.06)",
        transition: "all 0.2s",
    }

    const btnStyle: React.CSSProperties = {
        padding: "8px 16px",
        borderRadius: 8,
        border: "none",
        cursor: "pointer",
        fontFamily: "JetBrains Mono, monospace",
        fontSize: 12,
        fontWeight: 600,
    }

    const primaryBtn: React.CSSProperties = {
        ...btnStyle,
        background: "linear-gradient(135deg, #00d4aa, #00b894)",
        color: "#000",
    }

    const ghostBtn: React.CSSProperties = {
        ...btnStyle,
        background: "none",
        color: "var(--color-primary)",
        border: "1px solid rgba(0,212,170,0.2)",
    }

    const inputStyle: React.CSSProperties = {
        width: "100%",
        padding: "10px 14px",
        borderRadius: 8,
        border: "1px solid rgba(255,255,255,0.08)",
        background: "rgba(0,0,0,0.3)",
        color: "var(--color-text)",
        fontFamily: "JetBrains Mono, monospace",
        fontSize: 13,
        boxSizing: "border-box",
    }

    // ── Loading ────────────────────────────────────────────────

    if (loading) {
        return (
            <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "16px 0" }}>
                {[1, 2, 3].map(i => (
                    <div key={i} className="k-shimmer" style={{ height: 60, borderRadius: 8, background: "var(--color-border)" }} />
                ))}
            </div>
        )
    }

    // ── Pool List ──────────────────────────────────────────────

    if (view === "pools") {
        return (
            <div id="gnoswap-pools" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span style={{ fontSize: 20 }}>🔄</span>
                        <h3 style={{ fontSize: 15, fontWeight: 600, color: "var(--color-text)", margin: 0 }}>
                            GnoSwap Pools
                        </h3>
                    </div>
                    {auth.isAuthenticated && (
                        <button id="gnoswap-new-swap" onClick={() => setView("swap")} style={primaryBtn}>
                            + New Swap
                        </button>
                    )}
                </div>

                {error && <div style={{ color: "var(--color-danger)", fontSize: 12 }}>{error}</div>}

                {pools.length === 0 ? (
                    <div style={{ ...cardStyle, textAlign: "center", padding: 24 }}>
                        <div style={{ fontSize: 12, color: "var(--color-text-secondary)", fontFamily: "JetBrains Mono, monospace" }}>
                            No pools available on this chain. GnoSwap may not be deployed yet.
                        </div>
                    </div>
                ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {pools.map(pool => (
                            <div key={pool.path} id={`pool-${pool.path}`} style={cardStyle}>
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                    <div>
                                        <span style={{ fontSize: 14, fontWeight: 600, color: "var(--color-text)" }}>
                                            {pool.token0}/{pool.token1}
                                        </span>
                                        <span style={{
                                            fontSize: 10, marginLeft: 8, padding: "2px 6px",
                                            borderRadius: 4, background: "rgba(0,212,170,0.08)", color: "var(--color-primary)",
                                        }}>
                                            {(pool.feeTier / 10000).toFixed(2)}%
                                        </span>
                                    </div>
                                    <span style={{ fontSize: 12, color: "var(--color-text-secondary)", fontFamily: "JetBrains Mono, monospace" }}>
                                        TVL: {pool.tvl}
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        )
    }

    // ── Swap Form ──────────────────────────────────────────────

    if (view === "swap") {
        const slippageWarning = isSlippageWarning(slippage)

        // DF-M1: Compute estimated min output for display
        const estimatedMinOut = amountIn ? calculateMinOutput(amountIn, slippage) : ""
        // UX-L3: Collect unique tokens from loaded pools for dropdown
        const knownTokens = [...new Set(pools.flatMap(p => [p.token0, p.token1]))]

        return (
            <div id="gnoswap-swap" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <button onClick={() => setView("pools")} style={ghostBtn} aria-label="Back to pools">
                        ←
                    </button>
                    <h3 style={{ fontSize: 15, fontWeight: 600, color: "var(--color-text)", margin: 0 }}>
                        🔄 Swap Tokens
                    </h3>
                </div>

                {error && <div style={{ color: "var(--color-danger)", fontSize: 12 }}>{error}</div>}

                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    <div>
                        <label style={{ fontSize: 11, color: "var(--color-text-secondary)", display: "block", marginBottom: 4 }}>Token In</label>
                        <input
                            id="swap-token-in"
                            type="text"
                            list="swap-tokens-list"
                            placeholder="gno.land/r/demo/gns"
                            value={tokenIn}
                            onChange={e => setTokenIn(e.target.value)}
                            style={inputStyle}
                        />
                    </div>
                    <div>
                        <label style={{ fontSize: 11, color: "var(--color-text-secondary)", display: "block", marginBottom: 4 }}>Token Out</label>
                        <input
                            id="swap-token-out"
                            type="text"
                            list="swap-tokens-list"
                            placeholder="gno.land/r/demo/wugnot"
                            value={tokenOut}
                            onChange={e => setTokenOut(e.target.value)}
                            style={inputStyle}
                        />
                    </div>
                    {/* UX-L3: Token suggestions from loaded pools */}
                    <datalist id="swap-tokens-list">
                        {knownTokens.map(t => <option key={t} value={t} />)}
                    </datalist>
                    <div>
                        <label style={{ fontSize: 11, color: "var(--color-text-secondary)", display: "block", marginBottom: 4 }}>Amount In</label>
                        <input
                            id="swap-amount-in"
                            type="text"
                            placeholder="1000000"
                            value={amountIn}
                            onChange={e => setAmountIn(e.target.value)}
                            style={inputStyle}
                        />
                    </div>

                    {/* DF-M1: Estimated output display */}
                    {amountIn && estimatedMinOut && (
                        <div id="swap-estimated-output" style={{
                            padding: "12px 16px",
                            borderRadius: 8,
                            background: "rgba(0,212,170,0.04)",
                            border: "1px solid rgba(0,212,170,0.1)",
                        }}>
                            <div style={{ fontSize: 11, color: "var(--color-text-secondary)", marginBottom: 4 }}>
                                Minimum Output (after {slippage}% slippage)
                            </div>
                            <div style={{ fontSize: 16, fontWeight: 600, color: "var(--color-primary)", fontFamily: "JetBrains Mono, monospace" }}>
                                {estimatedMinOut}
                            </div>
                        </div>
                    )}

                    <div>
                        <label style={{ fontSize: 11, color: "var(--color-text-secondary)", display: "block", marginBottom: 4 }}>
                            Slippage Tolerance (%)
                        </label>
                        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                            {[0.1, 0.5, 1.0].map(s => (
                                <button
                                    key={s}
                                    onClick={() => setSlippage(s)}
                                    style={{
                                        ...ghostBtn,
                                        padding: "4px 12px",
                                        fontSize: 11,
                                        background: slippage === s ? "rgba(0,212,170,0.1)" : "none",
                                    }}
                                >
                                    {s}%
                                </button>
                            ))}
                            <input
                                id="swap-slippage"
                                type="number"
                                min="0.01"
                                max="5"
                                step="0.1"
                                value={slippage}
                                onChange={e => setSlippage(parseFloat(e.target.value) || 0.5)}
                                style={{ ...inputStyle, width: 80 }}
                            />
                        </div>
                        {slippageWarning && (
                            <div style={{ color: "var(--color-warning)", fontSize: 11, marginTop: 4 }}>
                                ⚠️ High slippage — you may receive significantly less tokens
                            </div>
                        )}
                    </div>
                </div>

                <div style={{ display: "flex", gap: 10 }}>
                    <button
                        id="swap-submit"
                        onClick={handleSwap}
                        disabled={posting || !tokenIn || !tokenOut || !amountIn}
                        style={{ ...primaryBtn, opacity: posting ? 0.5 : 1 }}
                    >
                        {posting ? "Swapping..." : "Swap"}
                    </button>
                    <button onClick={() => setView("pools")} style={ghostBtn}>
                        Cancel
                    </button>
                </div>
            </div>
        )
    }

    return null
}
