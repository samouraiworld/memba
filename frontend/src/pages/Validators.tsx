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

import { useNetworkNav, useNetworkKey } from "../hooks/useNetworkNav"
import { useIsMobile } from "../hooks/useIsMobile"
import { ValidatorCard } from "../components/validators/ValidatorCard"
import { ValidatorSortSelect, type SortKey } from "../components/validators/ValidatorSortSelect"
import { useState, useEffect, useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { Link, useSearchParams } from "react-router-dom"
import { useTabListKeyboard } from "../hooks/useTabListKeyboard"
import { ConnectingLoader } from "../components/ui/ConnectingLoader"
import { Copy, CheckCircle } from "@phosphor-icons/react"
import { GNO_RPC_URL, GNO_CHAIN_ID, getTelemetryRpcUrls, isReviewsEnabled } from "../lib/config"
import {
    getValidators,
    getNetworkStats,
    getAggregatedNetPeers,
    formatVotingPower,
    formatBlockTime,
    truncateValidatorAddr,
    mergeWithMonitoringData,
    fetchValoperMonikers,
    mergeValoperMonikers,
    fetchLastBlockSignatures,
    formatRelativeTime,
    type ValidatorInfo,
} from "../lib/validators"
import { NetworkNodesRoster } from "../components/validators/NetworkNodesRoster"
import { ValoperPanel } from "../components/validators/ValoperPanel"
import { ValidatorHoverCard } from "../components/validators/ValidatorHoverCard"
import { ValidatorReviewStars, ValidatorReviewPreview } from "../components/validators/ValidatorReviewStars"
import { buildSigningToOperator, resolveReviewSubjects } from "../components/validators/validatorReviewsData"
import { fetchValopers, type ValoperWithStatus } from "../lib/valopers"
import { fetchAllMonitoringData, type MonitoringIncident } from "../lib/gnomonitoring"
import {
    BarChart, Bar, XAxis, YAxis, Tooltip,
    ResponsiveContainer, CartesianGrid, Legend,
} from "recharts"
import {
    computeHealthStatus,
    computeNetworkHealth,
    healthCssClass,
    healthLabel,
    healthIcon,
} from "../lib/validatorHealth"
import "./validators.css"

const REFRESH_INTERVAL_MS = 30_000 // 30s standard polling

// Stable empty fallbacks so derived memos don't churn between renders.
const NO_VALIDATORS: ValidatorInfo[] = []
const NO_MONIKERS: Set<string> = new Set()
const NO_VALOPERS: ValoperWithStatus[] = []

// The overview page is segmented into three deep-linkable views (?tab=…) so the
// page is no longer one long scroll: the active consensus set, the registered
// operators, and the raw network topology are distinct concepts.
const OVERVIEW_TABS = ["validators", "candidates", "network"] as const
type OverviewTab = (typeof OVERVIEW_TABS)[number]

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
                    .catch(() => { setCopied(false) })
            }}
        >
            {copied ? <CheckCircle size={13} weight="fill" className="val-copy-ok" /> : <Copy size={13} />}
        </button>
    )
}

/** Compact preview shown in the row hovercard. */
function ValidatorRowPreview({ v, signingToOperator }: { v: ValidatorInfo; signingToOperator: Map<string, string> }) {
    const { subject, aliases } = resolveReviewSubjects(v.gnoAddr, signingToOperator)
    return (
        <div className="vhc-card">
            <div className="vhc-head">
                <span className="vhc-name">{v.moniker || truncateValidatorAddr(v.address)}</span>
                <span className={`val-health-badge ${healthCssClass(v.healthStatus)}`}>
                    <span className="val-health-badge__icon">{healthIcon(v.healthStatus)}</span>
                    <span className="val-health-badge__label">{healthLabel(v.healthStatus)}</span>
                </span>
            </div>
            <dl className="vhc-rows">
                <div><dt>Voting power</dt><dd className="val-mono">{formatVotingPower(v.votingPower)} · {v.powerPercent.toFixed(1)}%</dd></div>
                {v.uptimePercent != null && <div><dt>Uptime</dt><dd>{v.uptimePercent}%</dd></div>}
                {v.participationRate != null && <div><dt>Participation</dt><dd>{v.participationRate}%</dd></div>}
                <div><dt>Rank</dt><dd>#{v.rank}</dd></div>
            </dl>
            {isReviewsEnabled() && subject && <ValidatorReviewPreview subject={subject} aliases={aliases} />}
            <div className="vhc-foot">Open profile →</div>
        </div>
    )
}

export default function Validators() {
    const navigate = useNetworkNav()
    const nk = useNetworkKey()
    const isMobile = useIsMobile()
    const telemetryRpcUrls = useMemo(() => getTelemetryRpcUrls(), [])

    // ── Server state, in React Query ──────────────────────────
    // The roster poll: core fetch fan-out, sequential stats (H-11: stats needs
    // the prefetched validators), then the three-stage merge. Polls every
    // REFRESH_INTERVAL_MS; the shared client's refetchIntervalInBackground:false
    // is the old Page-Visibility gate (C2/M8), and the queryFn's AbortSignal
    // replaces the manual AbortController.
    const rosterQuery = useQuery({
        queryKey: ["validators", "roster"],
        refetchInterval: REFRESH_INTERVAL_MS,
        queryFn: async ({ signal }) => {
            const [vals, monitoringMap, valoperMap, sigMap] = await Promise.all([
                getValidators(GNO_RPC_URL),
                fetchAllMonitoringData(signal),
                fetchValoperMonikers(GNO_RPC_URL),
                fetchLastBlockSignatures(GNO_RPC_URL, 100),
            ])
            const netStats = await getNetworkStats(GNO_RPC_URL, vals, signal)
            // v2.13: valoper monikers first (primary on-chain source), then
            // gnomonitoring enrichment, then signatures + health.
            const withMonikers = mergeValoperMonikers(vals, valoperMap)
            const enriched = mergeWithMonitoringData(withMonikers, monitoringMap)
            const withHealth = enriched.map(v => {
                const withSigs = {
                    ...v,
                    lastBlockSignatures: sigMap.get(v.gnoAddr.toLowerCase()) || [],
                }
                const healthMeta = computeHealthStatus(withSigs)
                return { ...withSigs, healthStatus: healthMeta.status, healthMeta }
            })
            return {
                validators: withHealth,
                stats: netStats,
                networkHealth: computeNetworkHealth(withHealth),
                valoperMonikers: new Set([...valoperMap.values()].map(m => m.toLowerCase())),
                activeSigning: new Set(withHealth.map(v => v.gnoAddr)),
            }
        },
    })
    const validators = rosterQuery.data?.validators ?? NO_VALIDATORS
    const stats = rosterQuery.data?.stats ?? null
    const networkHealth = rosterQuery.data?.networkHealth ?? null
    const valoperMonikers = rosterQuery.data?.valoperMonikers ?? NO_MONIKERS
    const loading = rosterQuery.isPending
    const refreshing = rosterQuery.isFetching && !rosterQuery.isPending
    // Silent-refresh semantics preserved: a background refetch that fails keeps
    // showing data (react-query retains it); the error state only renders when
    // there is nothing to show.
    const error = rosterQuery.isError && !rosterQuery.data
        ? (rosterQuery.error instanceof Error ? rosterQuery.error.message : "Failed to load validator data")
        : null

    // Full network roster (peers aggregated across trusted RPCs) — best-effort
    // and independent, so a slow or dead telemetry node never delays the table.
    const netInfoQuery = useQuery({
        queryKey: ["validators", "netpeers"],
        refetchInterval: REFRESH_INTERVAL_MS,
        queryFn: async ({ signal }) => {
            try {
                return await getAggregatedNetPeers(telemetryRpcUrls, signal)
            } catch {
                return null
            }
        },
    })
    const netInfo = netInfoQuery.data ?? null

    // Valoper onboarding registry — needs the active signing set, so it waits
    // for the roster (non-blocking for the table, exactly as before).
    const valopersQuery = useQuery({
        queryKey: ["validators", "valopers"],
        enabled: !!rosterQuery.data,
        refetchInterval: REFRESH_INTERVAL_MS,
        queryFn: async () => {
            try {
                return await fetchValopers(GNO_RPC_URL, rosterQuery.data!.activeSigning)
            } catch {
                return NO_VALOPERS
            }
        },
    })
    const valopers = valopersQuery.data ?? NO_VALOPERS
    const valopersLoading = valopersQuery.isPending

    const [sortKey, setSortKey] = useState<SortKey>("rank")
    const [sortAsc, setSortAsc] = useState(true)
    const [search, setSearch] = useState("")
    const [page, setPage] = useState(1)
    const [pageSize, setPageSize] = useState(50)

    // Active segment (?tab=operators|network; default "validators"). Deep-linkable.
    const [searchParams, setSearchParams] = useSearchParams()
    const tabParam = searchParams.get("tab")
    const tab: OverviewTab = (OVERVIEW_TABS as readonly string[]).includes(tabParam ?? "")
        ? (tabParam as OverviewTab)
        : "validators"
    const setTab = (t: OverviewTab) => setSearchParams(prev => {
        const next = new URLSearchParams(prev)
        if (t === "validators") next.delete("tab"); else next.set("tab", t)
        return next
    })
    // APG tabs keyboard contract (roving tabindex, arrows, Home/End) — the
    // shared hook Directory extracted; these segments had no keyboard support.
    const { tabProps } = useTabListKeyboard<OverviewTab>({
        keys: OVERVIEW_TABS,
        active: tab,
        onSelect: setTab,
        idFor: (k) => `val-seg-${k}`,
    })
    // Active validators already appear in the Validators tab; the Candidates tab
    // focuses on registered operators not yet in the consensus set.
    const candidateValopers = useMemo(() => valopers.filter(v => v.status === "candidate"), [valopers])
    // Signing (consensus) address → operator address, so each row's review stars
    // query the same canonical subject the profile posts to (fixes reviews only
    // showing for validators whose operator address equals their signing address).
    const signingToOperator = useMemo(() => buildSigningToOperator(valopers), [valopers])
    // Page title
    useEffect(() => { document.title = "Validators — Memba" }, [])

    // ── Hacker Mode polling — REMOVED (moved to /validators/hacker dedicated page) ──

    const handleSort = (key: SortKey) => {
        if (sortKey === key) setSortAsc(!sortAsc)
        else { setSortKey(key); setSortAsc(key === "rank") }
    }

    // Mobile shows a lighter page (25 rows of cards) regardless of the desktop
    // page-size dropdown, halving the initial roster height on a phone.
    const effectivePageSize = isMobile ? Math.min(pageSize, 25) : pageSize

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

        const tp = Math.max(1, Math.ceil(f.length / effectivePageSize))
        const cp = Math.min(page, tp)
        const start = (cp - 1) * effectivePageSize
        const end = Math.min(start + effectivePageSize, f.length)
        const p = f.slice(start, end)

        return { filtered: f, paginated: p, totalPages: tp, currentPage: cp, paginatedStart: start, paginatedEnd: end }
    }, [validators, search, sortKey, sortAsc, page, effectivePageSize])

    // Reset to page 1 when search or page size changes — render-phase state
    // adjustment (the React-recommended pattern), not an effect.
    const [prevPageInputs, setPrevPageInputs] = useState(`${search}|${pageSize}`)
    const pageInputs = `${search}|${pageSize}`
    if (prevPageInputs !== pageInputs) {
        setPrevPageInputs(pageInputs)
        setPage(1)
    }

    // Has monitoring data? Check all metrics sources, not just participation/uptime
    const hasMonitoring = validators.some(v =>
        v.participationRate != null || v.uptimePercent != null ||
        v.txContrib != null || (v.incidents && v.incidents.length > 0)
    )

    // Memoize incidents chart data — must be before early returns (React hooks rule)
    const incidentsChartData = useMemo(() => {
        if (validators.length === 0) return null
        const allIncidents: MonitoringIncident[] = validators.flatMap(v => v.incidents ?? [])
        if (allIncidents.length === 0) return null
        const byDate = new Map<string, { date: string; critical: number; warning: number; info: number }>()
        for (const inc of allIncidents) {
            const d = inc.timestamp?.slice(0, 10)
            if (!d) continue
            const entry = byDate.get(d) ?? { date: d, critical: 0, warning: 0, info: 0 }
            const sev = inc.severity?.toUpperCase() ?? "INFO"
            if (sev === "CRITICAL") entry.critical++
            else if (sev === "WARNING") entry.warning++
            else entry.info++
            byDate.set(d, entry)
        }
        const chartData = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-30)
        return chartData.length > 0 ? chartData : null
    }, [validators])

    if (loading) {
        return <ConnectingLoader message="Loading validator data..." minHeight="40vh" />
    }

    if (error) {
        return (
            <div className="val-error">
                <span>⚠ {error}</span>
                <button onClick={() => void rosterQuery.refetch()} className="val-retry-btn">Retry</button>
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

            {/* ── Segment tabs (deep-linkable via ?tab=) ───────── */}
            <div className="val-segtabs" role="tablist" aria-label="Validators sections">
                <button
                    type="button" {...tabProps("validators")} data-testid="seg-validators"
                    className={`val-segtab${tab === "validators" ? " val-segtab--active" : ""}`}
                    onClick={() => setTab("validators")}
                >
                    Validators{stats && <span className="val-segtab__count">{stats.totalValidators}</span>}
                </button>
                <button
                    type="button" {...tabProps("candidates")} data-testid="seg-candidates"
                    className={`val-segtab${tab === "candidates" ? " val-segtab--active" : ""}`}
                    onClick={() => setTab("candidates")}
                >
                    Candidates{candidateValopers.length > 0 && <span className="val-segtab__count">{candidateValopers.length}</span>}
                </button>
                <button
                    type="button" {...tabProps("network")} data-testid="seg-network"
                    className={`val-segtab${tab === "network" ? " val-segtab--active" : ""}`}
                    onClick={() => setTab("network")}
                >
                    Network{netInfo?.peerCount ? <span className="val-segtab__count">{netInfo.peerCount}</span> : null}
                </button>
            </div>

            {/* ── Validators tab: stats + live metrics table ───── */}
            {tab === "validators" && (<>
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

                    {netInfo != null && (
                        <button type="button" onClick={() => setTab("network")} className="val-stat-card val-stat-card--link" title="Open the full network node roster">
                            <span className="val-stat-label">Network Nodes</span>
                            <span className="val-stat-value">{netInfo.peerCount}</span>
                            <span className="val-stat-hint">Peers seen · view roster →</span>
                        </button>
                    )}

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
                    {isMobile ? (
                        // Mobile cards have no sortable column headers — restore sort
                        // parity here (and the roster is clamped to 25, so the
                        // page-size dropdown is moot on a phone).
                        <ValidatorSortSelect
                            sortKey={sortKey}
                            sortAsc={sortAsc}
                            hasMonitoring={hasMonitoring}
                            onChange={(k, a) => { setSortKey(k); setSortAsc(a) }}
                        />
                    ) : (
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
                    )}
                    <span className="val-count">
                        {filtered.length} validator{filtered.length !== 1 ? "s" : ""}
                    </span>
                </div>
            </div>

            {/* ── Validator Table ──────────────────────────────── */}
            {isMobile ? (
                <div className="val-cards" data-testid="validator-cards">
                    {paginated.map(v => (
                        <ValidatorCard
                            key={v.address}
                            v={v}
                            hasMonitoring={hasMonitoring}
                            to={`/${nk}/validators/${v.gnoAddr || v.address}`}
                        />
                    ))}
                </div>
            ) : (
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
                            {isReviewsEnabled() && (
                                <th className="val-th val-th-center">Reviews</th>
                            )}
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
                            <ValidatorHoverCard key={v.address} content={<ValidatorRowPreview v={v} signingToOperator={signingToOperator} />}>
                            <tr
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
                                        {v.operationTime != null ? `${v.operationTime}d` : formatRelativeTime(v.startTime)}
                                    </span>
                                </td>
                                <td className="val-td val-td-center">
                                    {v.profileUrl ? (
                                        <a href={v.profileUrl} target="_blank" rel="noopener noreferrer" className="val-profile-link">
                                            Gnoweb ↗
                                        </a>
                                    ) : "—"}
                                </td>
                                {isReviewsEnabled() && (() => {
                                    const { subject, aliases } = resolveReviewSubjects(v.gnoAddr, signingToOperator)
                                    return (
                                        <td className="val-td val-td-center">
                                            <ValidatorReviewStars subject={subject} aliases={aliases} />
                                        </td>
                                    )
                                })()}
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
                            </ValidatorHoverCard>
                        ))}
                    </tbody>
                </table>
            </div>
            )}

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

            </>)}

            {/* ── Candidates tab: registered operators not yet in the active set ──
                 Active validators already live in the Validators tab, so this focuses
                 on candidates. */}
            {tab === "candidates" && (
                <ValoperPanel valopers={candidateValopers} loading={valopersLoading} />
            )}

            {/* ── Network tab: incidents timeline chart ────────── */}
            {tab === "network" && incidentsChartData && incidentsChartData.length > 0 && (
                    <div className="val-health-banner" style={{ marginBottom: 16 }}>
                        <div className="val-health-banner__title">Incidents Timeline (last 30 days)</div>
                        <ResponsiveContainer width="100%" height={180}>
                            <BarChart data={incidentsChartData} margin={{ left: 0, right: 10, top: 10, bottom: 0 }}>
                                <CartesianGrid stroke="rgba(255,255,255,0.04)" />
                                <XAxis dataKey="date" tick={{ fill: "var(--color-text-secondary)", fontSize: 9 }} tickFormatter={(v: string) => v.slice(5)} />
                                <YAxis tick={{ fill: "var(--color-text-secondary)", fontSize: 9 }} allowDecimals={false} />
                                <Tooltip contentStyle={{ background: "var(--color-surface-abyss)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 6, fontSize: 11 }} />
                                <Legend iconType="circle" wrapperStyle={{ fontSize: 10 }} formatter={(value) => <span style={{ color: "var(--color-k-text)" }}>{value}</span>} />
                                <Bar dataKey="critical" name="Critical" stackId="incidents" fill="var(--color-danger)" />
                                <Bar dataKey="warning" name="Warning" stackId="incidents" fill="var(--color-status-warning-muted)" />
                                <Bar dataKey="info" name="Info" stackId="incidents" fill="var(--color-info)" />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
            )}

            {/* ── Voting Power Distribution (Validators tab) ───── */}
            {tab === "validators" && validators.length > 0 && (
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

            {/* ── Network tab: full node roster ────────────────── */}
            {tab === "network" && (
                <NetworkNodesRoster netInfo={netInfo} validatorMonikers={valoperMonikers} loading={loading} />
            )}
        </div>
    )
}
