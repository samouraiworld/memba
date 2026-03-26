/**
 * Validators page — Network stats + enriched validator table.
 *
 * Data sources:
 * - Tendermint/CometBFT JSON-RPC: voting power, pubkey, consensus set
 * - gnomonitoring API: monikers, participation rate, uptime
 * - /dump_consensus_state: H/R/S live consensus (Hacker Mode)
 * - /net_info: connected peers (Hacker Mode)
 *
 * Modes:
 * - Standard: validator table with sorting, search, pagination.
 * - Hacker: live consensus telemetry, 100-block heatmap, peer table.
 *
 * Design: premium dark UI with smooth animations, validator cards.
 * Hacker Mode: matrix CLI aesthetic, monospace, neon green.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from "react"
import { useNavigate, Link } from "react-router-dom"
import { ConnectingLoader } from "../components/ui/ConnectingLoader"
import { Copy, CheckCircle } from "@phosphor-icons/react"
import { GNO_RPC_URL, GNO_CHAIN_ID } from "../lib/config"
import {
    getValidators,
    getNetworkStats,
    formatVotingPower,
    formatBlockTime,
    truncateValidatorAddr,
    mergeWithMonitoringData,
    fetchValoperMonikers,
    mergeValoperMonikers,
    fetchLastBlockSignatures,
    formatRelativeTime,
    type ValidatorInfo,
    type NetworkStats,
} from "../lib/validators"
import { fetchAllMonitoringData } from "../lib/gnomonitoring"
import {
    computeHealthStatus,
    computeNetworkHealth,
    healthCssClass,
    healthLabel,
    healthIcon,
    type NetworkHealthSummary,
} from "../lib/validatorHealth"
import "./validators.css"

type SortKey = "rank" | "votingPower" | "powerPercent" | "participationRate" | "uptimePercent" | "missedBlocks" | "txContrib"

const REFRESH_INTERVAL_MS = 30_000 // 30s standard polling

/** Tiny copy-to-clipboard button. */
function CopyButton({ text }: { text: string }) {
    const [copied, setCopied] = useState(false)
    return (
        <button
            className="val-copy-btn"
            title="Copy address"
            onClick={(e) => {
                e.stopPropagation()
                navigator.clipboard.writeText(text)
                    .then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200) })
                    .catch(() => { setCopied(true); setTimeout(() => setCopied(false), 1200) })
            }}
        >
            {copied ? <CheckCircle size={13} weight="fill" className="val-copy-ok" /> : <Copy size={13} />}
        </button>
    )
}

export default function Validators() {
    const navigate = useNavigate()
    const [validators, setValidators] = useState<ValidatorInfo[]>([])
    const [stats, setStats] = useState<NetworkStats | null>(null)
    const [networkHealth, setNetworkHealth] = useState<NetworkHealthSummary | null>(null)
    const [loading, setLoading] = useState(true)
    const [refreshing, setRefreshing] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [sortKey, setSortKey] = useState<SortKey>("rank")
    const [sortAsc, setSortAsc] = useState(true)
    const [search, setSearch] = useState("")
    const [page, setPage] = useState(1)
    const [pageSize, setPageSize] = useState(50)
    const isVisible = useRef(true)
    const abortRef = useRef<AbortController | null>(null)

    const loadData = useCallback(async (isRefresh = false) => {
        // Cancel any previous in-flight request
        abortRef.current?.abort()
        const controller = new AbortController()
        abortRef.current = controller

        if (isRefresh) setRefreshing(true)
        try {
            // v2.17.2: ALL data sources in single parallel burst (was sequential for stats)
            const [vals, monitoringMap, valoperMap, sigMap, netStats] = await Promise.all([
                getValidators(GNO_RPC_URL),
                fetchAllMonitoringData(controller.signal),
                fetchValoperMonikers(GNO_RPC_URL),
                fetchLastBlockSignatures(GNO_RPC_URL, 100),
                getNetworkStats(GNO_RPC_URL),
            ])

            // v2.13: Apply valopers monikers first (primary on-chain source)
            const withMonikers = mergeValoperMonikers(vals, valoperMap)
            // Then enrich with gnomonitoring data (participation, uptime, incidents, missed blocks)
            const enriched = mergeWithMonitoringData(withMonikers, monitoringMap)

            // v2.14: Merge block signatures + v2.17: compute health status
            const withHealth = enriched.map(v => {
                const withSigs = {
                    ...v,
                    lastBlockSignatures: sigMap.get(v.gnoAddr.toLowerCase()) || [],
                }
                const healthMeta = computeHealthStatus(withSigs)
                return {
                    ...withSigs,
                    healthStatus: healthMeta.status,
                    healthMeta,
                }
            })

            setValidators(withHealth)
            setStats(netStats)
            setNetworkHealth(computeNetworkHealth(withHealth))
            setError(null)
        } catch (err) {
            if (controller.signal.aborted) return // Ignore aborted requests
            if (!isRefresh) {
                setError(err instanceof Error ? err.message : "Failed to load validator data")
            }
        } finally {
            setLoading(false)
            setRefreshing(false)
        }
    }, [])

    // Page Visibility API: pause polling when tab is hidden (C2/M8 fix)
    useEffect(() => {
        const handleVisibility = () => {
            isVisible.current = document.visibilityState === "visible"
        }
        document.addEventListener("visibilitychange", handleVisibility)
        return () => document.removeEventListener("visibilitychange", handleVisibility)
    }, [])

    // Page title
    useEffect(() => { document.title = "Validators — Memba" }, [])

    // Initial load + polling + AbortController cleanup
    useEffect(() => {
        loadData()
        const interval = setInterval(() => {
            if (isVisible.current) loadData(true)
        }, REFRESH_INTERVAL_MS)
        return () => {
            clearInterval(interval)
            abortRef.current?.abort()
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    // ── Hacker Mode polling — REMOVED (moved to /validators/hacker dedicated page) ──

    const handleSort = (key: SortKey) => {
        if (sortKey === key) setSortAsc(!sortAsc)
        else { setSortKey(key); setSortAsc(key === "rank") }
    }

    // Memoize filter + sort + paginate
    const { filtered, paginated, totalPages, currentPage, paginatedStart, paginatedEnd } = useMemo(() => {
        const f = validators
            .filter(v => {
                if (!search) return true
                const q = search.toLowerCase()
                return (
                    v.address.toLowerCase().includes(q) ||
                    v.moniker.toLowerCase().includes(q) ||
                    v.gnoAddr.toLowerCase().includes(q)
                )
            })
            .sort((a, b) => {
                const mul = sortAsc ? 1 : -1
                const av = a[sortKey] ?? -1
                const bv = b[sortKey] ?? -1
                return mul * ((av as number) - (bv as number))
            })

        const tp = Math.max(1, Math.ceil(f.length / pageSize))
        const cp = Math.min(page, tp)
        const start = (cp - 1) * pageSize
        const end = Math.min(start + pageSize, f.length)
        const p = f.slice(start, end)

        return { filtered: f, paginated: p, totalPages: tp, currentPage: cp, paginatedStart: start, paginatedEnd: end }
    }, [validators, search, sortKey, sortAsc, page, pageSize])

    // Reset to page 1 on search change
    useEffect(() => { setPage(1) }, [search, pageSize])

    // Has monitoring data?
    const hasMonitoring = validators.some(v => v.participationRate != null || v.uptimePercent != null)

    if (loading) {
        return <ConnectingLoader message="Loading validator data..." minHeight="40vh" />
    }

    if (error) {
        return (
            <div className="val-error">
                <span>⚠ {error}</span>
                <button onClick={() => loadData()} className="val-retry-btn">Retry</button>
            </div>
        )
    }

    return (
        <div className="val-page" data-testid="validators-page">
            <div className="val-header">
                <h1>⛓️ Validators</h1>
                <span className="val-chain-badge">{GNO_CHAIN_ID}</span>
                {refreshing && <span className="val-refreshing" aria-live="polite">Refreshing…</span>}
                <Link to="/validators/hacker" className="val-hacker-btn" title="Open live consensus telemetry dashboard">
                    🕵️ Hacker view
                </Link>
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

            {/* ── Network Health Banner (v2.17.0) ──────────────── */}
            {networkHealth && (
                <div className="val-health-banner" data-testid="network-health-banner">
                    <div className="val-health-banner__title">🩺 Network Health</div>
                    <div className="val-health-banner__grid">
                        <div className="val-health-banner__stat">
                            <span className="val-health-dot val-health-dot--healthy" />
                            <span className="val-health-banner__count">{networkHealth.healthy}</span>
                            <span className="val-health-banner__label">Healthy</span>
                        </div>
                        <div className="val-health-banner__stat">
                            <span className="val-health-dot val-health-dot--degraded" />
                            <span className="val-health-banner__count">{networkHealth.degraded}</span>
                            <span className="val-health-banner__label">Degraded</span>
                        </div>
                        <div className="val-health-banner__stat">
                            <span className="val-health-dot val-health-dot--down" />
                            <span className="val-health-banner__count">{networkHealth.down}</span>
                            <span className="val-health-banner__label">Down</span>
                        </div>
                        <div className="val-health-banner__stat">
                            <span className="val-health-dot val-health-dot--unknown" />
                            <span className="val-health-banner__count">{networkHealth.unknown}</span>
                            <span className="val-health-banner__label">Unknown</span>
                        </div>
                        {networkHealth.avgUptime != null && (
                            <div className="val-health-banner__stat">
                                <span className="val-health-banner__count">{networkHealth.avgUptime}%</span>
                                <span className="val-health-banner__label">Avg Uptime</span>
                            </div>
                        )}
                    </div>
                    {networkHealth.latestIncident && (
                        <div className="val-health-banner__incident">
                            <span className={`val-incident-badge val-incident-badge--${networkHealth.latestIncident.severity.toLowerCase()}`}>
                                {networkHealth.latestIncident.severity}
                            </span>
                            <span className="val-health-banner__incident-text">
                                <strong>{networkHealth.latestIncident.moniker}</strong>: {networkHealth.latestIncident.details}
                            </span>
                        </div>
                    )}
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
                            title={`#${v.rank} — ${v.moniker || truncateValidatorAddr(v.address)} (${v.powerPercent.toFixed(1)}%)`}
                        />
                    ))}
                </div>
            )}

            {/* ── 🕵️ Hacker Mode moved to /validators/hacker ─────── */}

            {/* ── Search + Page Size ─────────────────────────────── */}
            <div className="val-toolbar">
                <input
                    type="text"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder={hasMonitoring ? "Search by name or address..." : "Search by address..."}
                    className="val-search"
                    data-testid="validator-search"
                />
                <div className="val-toolbar-right">
                    <select
                        className="val-page-size"
                        value={pageSize}
                        onChange={e => setPageSize(Number(e.target.value))}
                        data-testid="validator-page-size"
                    >
                        <option value={25}>25 / page</option>
                        <option value={50}>50 / page</option>
                        <option value={100}>100 / page</option>
                    </select>
                    <span className="val-count">
                        {filtered.length} validator{filtered.length !== 1 ? "s" : ""}
                    </span>
                </div>
            </div>

            {/* ── Validator Table ──────────────────────────────── */}
            <div className="val-table-wrap">
                <table className="val-table" data-testid="validator-table">
                    <thead>
                        <tr>
                            <th className="val-th" onClick={() => handleSort("rank")}>
                                # {sortKey === "rank" && (sortAsc ? "↑" : "↓")}
                            </th>
                            <th className="val-th">Validator</th>
                            <th className="val-th val-th-right" onClick={() => handleSort("votingPower")}>
                                Voting Power {sortKey === "votingPower" && (sortAsc ? "↑" : "↓")}
                            </th>
                            <th className="val-th val-th-right" onClick={() => handleSort("powerPercent")}>
                                Share {sortKey === "powerPercent" && (sortAsc ? "↑" : "↓")}
                            </th>
                            <th className="val-th val-th-center">Active Since</th>
                            <th className="val-th val-th-center">Profile</th>
                            {hasMonitoring && (
                                <>
                                    <th className="val-th val-th-right" onClick={() => handleSort("participationRate")}>
                                        Participation {sortKey === "participationRate" && (sortAsc ? "↑" : "↓")}
                                    </th>
                                    <th className="val-th val-th-center" onClick={() => handleSort("uptimePercent")}>
                                        Uptime {sortKey === "uptimePercent" && (sortAsc ? "↑" : "↓")}
                                    </th>
                                    <th className="val-th val-th-center" onClick={() => handleSort("missedBlocks")}>
                                        Missed {sortKey === "missedBlocks" && (sortAsc ? "↑" : "↓")}
                                    </th>
                                    <th className="val-th val-th-right" onClick={() => handleSort("txContrib")}>
                                        TX Contrib {sortKey === "txContrib" && (sortAsc ? "↑" : "↓")}
                                    </th>
                                    <th className="val-th val-th-center">Last Down</th>
                                </>
                            )}
                            <th className="val-th val-th-center">Health</th>
                            <th className="val-th val-th-center">Last {validators[0]?.lastBlockSignatures?.length || 100} blocks</th>
                        </tr>
                    </thead>
                    <tbody>
                        {paginated.map(v => (
                            <tr
                                key={v.address}
                                className="val-row"
                                data-testid={`validator-row-${v.rank}`}
                                onClick={() => navigate(`/validators/${v.gnoAddr || v.address}`)}
                                onKeyDown={e => {
                                    if (e.key === "Enter" || e.key === " ") {
                                        e.preventDefault()
                                        navigate(`/validators/${v.gnoAddr || v.address}`)
                                    }
                                }}
                                tabIndex={0}
                                role="button"
                                aria-label={`View ${v.moniker || truncateValidatorAddr(v.address)} validator details`}
                                style={{ cursor: "pointer" }}
                                title={`View ${v.moniker || truncateValidatorAddr(v.address)} details`}
                            >
                                <td className="val-td val-rank">
                                    <span className={`val-rank-badge ${v.rank <= 3 ? "val-top3" : ""}`}>
                                        {v.rank}
                                    </span>
                                </td>
                                <td className="val-td val-addr">
                                    <div className="val-addr-wrap">
                                        {v.moniker ? (
                                            <>
                                                <span className="val-moniker">{v.moniker}</span>
                                                <span className="val-addr-sub">
                                                    <span className="val-mono">{v.gnoAddr || truncateValidatorAddr(v.address)}</span>
                                                    <CopyButton text={v.gnoAddr || v.address} />
                                                </span>
                                            </>
                                        ) : (
                                            <>
                                                <span className="val-addr-full val-mono">{v.address}</span>
                                                <span className="val-addr-sub">
                                                    <span className="val-pubkey-hint">{v.pubkeyType.replace("tendermint/PubKey", "")}</span>
                                                    <CopyButton text={v.address} />
                                                </span>
                                            </>
                                        )}
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
                                    <span className="val-start-time">
                                        {v.operationTime ? v.operationTime : formatRelativeTime(v.startTime)}
                                    </span>
                                </td>
                                <td className="val-td val-td-center">
                                    {v.profileUrl ? (
                                        <a href={v.profileUrl} target="_blank" rel="noopener noreferrer" className="val-profile-link">
                                            Gnoweb ↗
                                        </a>
                                    ) : "—"}
                                </td>
                                {hasMonitoring && (
                                    <>
                                        <td className="val-td val-td-right val-mono">
                                            {v.participationRate != null ? `${v.participationRate}%` : "—"}
                                        </td>
                                        <td className="val-td val-td-center">
                                            {v.uptimePercent != null ? (
                                                <span className={`val-uptime-badge ${v.uptimePercent >= 99 ? "val-uptime-good" : v.uptimePercent >= 90 ? "val-uptime-warn" : "val-uptime-bad"}`}>
                                                    {v.uptimePercent}%
                                                </span>
                                            ) : "—"}
                                        </td>
                                        <td className="val-td val-td-center">
                                            {v.missedBlocks != null ? (
                                                <span className={`val-missed-badge ${v.missedBlocks >= 30 ? "val-missed-critical" : v.missedBlocks >= 5 ? "val-missed-warn" : "val-missed-ok"}`}>
                                                    {v.missedBlocks}
                                                </span>
                                            ) : "—"}
                                        </td>
                                        <td className="val-td val-td-right val-mono">
                                            {v.txContrib != null ? `${v.txContrib.toFixed(1)}%` : "—"}
                                        </td>
                                        <td className="val-td val-td-center">
                                            <span className="val-start-time">
                                                {v.lastIncidentDate ? formatRelativeTime(v.lastIncidentDate) : "—"}
                                            </span>
                                        </td>
                                    </>
                                )}
                                <td className="val-td val-td-center">
                                    <span
                                        className={`val-health-badge ${healthCssClass(v.healthStatus)}`}
                                        title={v.healthMeta?.reason || ""}
                                    >
                                        <span className="val-health-badge__icon">{healthIcon(v.healthStatus)}</span>
                                        <span className="val-health-badge__label">{healthLabel(v.healthStatus)}</span>
                                    </span>
                                </td>
                                <td className="val-td val-td-center">
                                    {v.lastBlockSignatures.length > 0 ? (
                                        <div className="val-block-strip" title={`${v.lastBlockSignatures.filter(Boolean).length}/${v.lastBlockSignatures.length} blocks signed`}>
                                            {v.lastBlockSignatures.map((signed, i) => (
                                                <div key={i} className={`val-block-tick ${signed ? "val-tick-ok" : "val-tick-miss"}`} />
                                            ))}
                                        </div>
                                    ) : "—"}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* ── Pagination Controls ─────────────────────────── */}
            {totalPages > 1 && (
                <div className="val-pagination" data-testid="validator-pagination">
                    <button
                        className="val-page-btn"
                        onClick={() => setPage(p => Math.max(1, p - 1))}
                        disabled={currentPage <= 1}
                        aria-label="Previous page"
                    >
                        ← Prev
                    </button>
                    <span className="val-page-info" aria-live="polite">
                        Showing {paginatedStart + 1}–{paginatedEnd} of {filtered.length}
                    </span>
                    <button
                        className="val-page-btn"
                        onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                        disabled={currentPage >= totalPages}
                        aria-label="Next page"
                    >
                        Next →
                    </button>
                </div>
            )}
        </div>
    )
}
