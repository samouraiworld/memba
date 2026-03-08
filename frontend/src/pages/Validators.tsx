/**
 * Validators page — Network stats + validator table.
 *
 * Displays consensus data from Tendermint/CometBFT JSON-RPC:
 * - Network overview cards (block height, avg time, validators, power)
 * - Sortable validator table with voting power, rank, and status
 *
 * Design: premium dark UI with smooth animations and data visualizations.
 */

import { useState, useEffect, useCallback, useRef } from "react"
import { GNO_RPC_URL, GNO_CHAIN_ID } from "../lib/config"
import {
    getValidators,
    getNetworkStats,
    formatVotingPower,
    formatBlockTime,
    truncateValidatorAddr,
    type ValidatorInfo,
    type NetworkStats,
} from "../lib/validators"
import "./validators.css"

type SortKey = "rank" | "votingPower" | "powerPercent"

export default function Validators() {
    const [validators, setValidators] = useState<ValidatorInfo[]>([])
    const [stats, setStats] = useState<NetworkStats | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [sortKey, setSortKey] = useState<SortKey>("rank")
    const [sortAsc, setSortAsc] = useState(true)
    const [search, setSearch] = useState("")
    const refreshTimer = useRef<ReturnType<typeof setInterval> | null>(null)

    const loadData = useCallback(async () => {
        try {
            const [vals, netStats] = await Promise.all([
                getValidators(GNO_RPC_URL),
                getNetworkStats(GNO_RPC_URL),
            ])
            setValidators(vals)
            setStats(netStats)
            setError(null)
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to load validator data")
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        loadData()
        // Auto-refresh block height every 5 seconds
        refreshTimer.current = setInterval(loadData, 5_000)
        return () => { if (refreshTimer.current) clearInterval(refreshTimer.current) }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    const handleSort = (key: SortKey) => {
        if (sortKey === key) setSortAsc(!sortAsc)
        else { setSortKey(key); setSortAsc(key === "rank") }
    }

    const filtered = validators
        .filter(v => !search || v.address.toLowerCase().includes(search.toLowerCase()))
        .sort((a, b) => {
            const mul = sortAsc ? 1 : -1
            return mul * (a[sortKey] - b[sortKey])
        })

    if (loading) {
        return (
            <div className="val-loading">
                <div className="val-spinner" />
                <span>Loading validator data...</span>
            </div>
        )
    }

    if (error) {
        return (
            <div className="val-error">
                <span>⚠ {error}</span>
                <button onClick={loadData} className="val-retry-btn">Retry</button>
            </div>
        )
    }

    return (
        <div className="val-page" data-testid="validators-page">
            <div className="val-header">
                <h1>⛓️ Validators</h1>
                <span className="val-chain-badge">{GNO_CHAIN_ID}</span>
            </div>

            {/* ── Network Overview Cards ───────────────────────── */}
            {stats && (
                <div className="val-stats-grid" data-testid="network-stats">
                    <div className="val-stat-card">
                        <span className="val-stat-label">Block Height</span>
                        <span className="val-stat-value val-mono">
                            {stats.blockHeight.toLocaleString()}
                        </span>
                        <span className="val-stat-hint">
                            {stats.catchingUp ? "⏳ Syncing…" : "✅ Synced"}
                        </span>
                    </div>

                    <div className="val-stat-card">
                        <span className="val-stat-label">Avg Block Time</span>
                        <span className="val-stat-value">
                            {formatBlockTime(stats.avgBlockTime)}
                        </span>
                        <span className="val-stat-hint">Last 10 blocks</span>
                    </div>

                    <div className="val-stat-card">
                        <span className="val-stat-label">Active Validators</span>
                        <span className="val-stat-value">{stats.totalValidators}</span>
                        <span className="val-stat-hint">Consensus set</span>
                    </div>

                    <div className="val-stat-card">
                        <span className="val-stat-label">Total Voting Power</span>
                        <span className="val-stat-value val-mono">
                            {formatVotingPower(stats.totalVotingPower)}
                        </span>
                        <span className="val-stat-hint">Network weight</span>
                    </div>
                </div>
            )}

            {/* ── Voting Power Distribution ────────────────────── */}
            {validators.length > 0 && (
                <div className="val-power-bar" data-testid="power-distribution">
                    {validators.slice(0, 20).map((v, i) => (
                        <div
                            key={v.address}
                            className="val-power-segment"
                            style={{
                                width: `${Math.max(v.powerPercent, 1)}%`,
                                opacity: 0.4 + (0.6 * (1 - i / Math.max(validators.length, 1))),
                            }}
                            title={`#${v.rank} — ${truncateValidatorAddr(v.address)} (${v.powerPercent.toFixed(1)}%)`}
                        />
                    ))}
                </div>
            )}

            {/* ── Search ───────────────────────────────────────── */}
            <div className="val-toolbar">
                <input
                    type="text"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Search by address..."
                    className="val-search"
                    data-testid="validator-search"
                />
                <span className="val-count">
                    {filtered.length} validator{filtered.length !== 1 ? "s" : ""}
                </span>
            </div>

            {/* ── Validator Table ──────────────────────────────── */}
            <div className="val-table-wrap">
                <table className="val-table" data-testid="validator-table">
                    <thead>
                        <tr>
                            <th className="val-th" onClick={() => handleSort("rank")}>
                                # {sortKey === "rank" && (sortAsc ? "↑" : "↓")}
                            </th>
                            <th className="val-th">Address</th>
                            <th className="val-th val-th-right" onClick={() => handleSort("votingPower")}>
                                Voting Power {sortKey === "votingPower" && (sortAsc ? "↑" : "↓")}
                            </th>
                            <th className="val-th val-th-right" onClick={() => handleSort("powerPercent")}>
                                Share {sortKey === "powerPercent" && (sortAsc ? "↑" : "↓")}
                            </th>
                            <th className="val-th val-th-center">Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filtered.map(v => (
                            <tr key={v.address} className="val-row" data-testid={`validator-row-${v.rank}`}>
                                <td className="val-td val-rank">
                                    <span className={`val-rank-badge ${v.rank <= 3 ? "val-top3" : ""}`}>
                                        {v.rank}
                                    </span>
                                </td>
                                <td className="val-td val-addr">
                                    <div className="val-addr-wrap">
                                        <span className="val-addr-full val-mono">{truncateValidatorAddr(v.address)}</span>
                                        <span className="val-pubkey-hint">{v.pubkeyType.replace("tendermint/PubKey", "")}</span>
                                    </div>
                                </td>
                                <td className="val-td val-td-right val-mono">
                                    {formatVotingPower(v.votingPower)}
                                </td>
                                <td className="val-td val-td-right">
                                    <div className="val-power-cell">
                                        <div className="val-power-mini-bar" style={{ width: `${v.powerPercent}%` }} />
                                        <span>{v.powerPercent.toFixed(1)}%</span>
                                    </div>
                                </td>
                                <td className="val-td val-td-center">
                                    <span className={`val-status ${v.active ? "val-active" : "val-inactive"}`}>
                                        {v.active ? "Active" : "Inactive"}
                                    </span>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    )
}
