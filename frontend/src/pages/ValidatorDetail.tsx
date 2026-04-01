/**
 * ValidatorDetail — dedicated /validators/:address page.
 *
 * Sections:
 * 1. Breadcrumb header (← Validators / Moniker)
 * 2. Identity panel (rank, address, pubkey, status, proposer priority)
 * 3. Live Proposer badge (2s poll on /dump_consensus_state)
 * 4. Voting Power (absolute, %, power bar, rank)
 * 5. 100-block Signature Heatmap (this validator's signing history)
 * 6. Performance metrics (missed/signed last 100, uptime %, participation)
 * 7. Start time, external links (Gnoweb, explorer)
 *
 * Graceful: if the address is not found in the validator set, shows a 404 card.
 */

import { useNetworkNav } from "../hooks/useNetworkNav"
import { useState, useEffect, useRef, useCallback } from "react"
import { useParams, Link } from "react-router-dom"
import { Copy, CheckCircle } from "@phosphor-icons/react"
import { GNO_RPC_URL, GNO_CHAIN_ID, getTelemetryRpcUrl } from "../lib/config"
import {
    getValidators,
    getNetworkStats,
    getConsensusState,
    fetchBlockHeatmap,
    fetchLastBlockSignatures,
    formatVotingPower,
    formatRelativeTime,
    truncateValidatorAddr,
    mergeWithMonitoringData,
    type ValidatorInfo,
    type NetworkStats,
    type HackerConsensusState,
    type BlockSample,
} from "../lib/validators"
import { fetchAllMonitoringData } from "../lib/gnomonitoring"
import {
    computeHealthStatus,
    healthCssClass,
    healthLabel,
    healthIcon,
} from "../lib/validatorHealth"
import { BlockHeatmap } from "../components/validators/BlockHeatmap"
import { completeQuest, trackPageVisit } from "../lib/quests"
import "../components/validators/hacker-mode.css"
import "./validator-detail.css"

/** Tiny copy button */
function CopyBtn({ text }: { text: string }) {
    const [copied, setCopied] = useState(false)
    return (
        <button
            className="vd-copy"
            onClick={() => {
                navigator.clipboard.writeText(text).catch(() => {})
                setCopied(true)
                setTimeout(() => setCopied(false), 1400)
            }}
            title="Copy to clipboard"
            aria-label="Copy"
        >
            {copied ? <CheckCircle size={13} weight="fill" /> : <Copy size={13} />}
        </button>
    )
}

/** Mono address with copy button */
function AddrRow({ label, value }: { label: string; value: string }) {
    if (!value) return null
    return (
        <div className="vd-row">
            <span className="vd-row__label">{label}</span>
            <span className="vd-row__value vd-mono">
                {value}
                <CopyBtn text={value} />
            </span>
        </div>
    )
}

/** Progress bar (0–100%) */
function PowerBar({ percent }: { percent: number }) {
    return (
        <div className="vd-power-bar-wrap">
            <div className="vd-power-bar-fill" style={{ width: `${Math.min(percent, 100)}%` }} />
            <span className="vd-power-bar-label">{percent.toFixed(2)}%</span>
        </div>
    )
}

const CONSENSUS_POLL_MS = 2_000

export default function ValidatorDetail() {
    const { address } = useParams<{ address: string }>()
    const navigate = useNetworkNav()
    const rpcUrl = getTelemetryRpcUrl()
    const isVisible = useRef(true)
    const abortRef = useRef<AbortController | null>(null)

    const [validator, setValidator] = useState<ValidatorInfo | null>(null)
    const [stats, setStats] = useState<NetworkStats | null>(null)
    const [cs, setCs] = useState<HackerConsensusState | null>(null)
    const [heatmap, setHeatmap] = useState<BlockSample[]>([])
    const [loading, setLoading] = useState(true)
    const [notFound, setNotFound] = useState(false)

    // Page visibility
    useEffect(() => {
        const h = () => { isVisible.current = document.visibilityState === "visible" }
        document.addEventListener("visibilitychange", h)
        return () => document.removeEventListener("visibilitychange", h)
    }, [])

    // Guard: bech32 address must start with 'g1'
    useEffect(() => {
        if (address && !address.startsWith("g1")) {
            navigate("/validators", { replace: true })
        }
    }, [address, navigate])

    // Quest triggers
    useEffect(() => {
        if (address) {
            completeQuest("view-validator")
            trackPageVisit("validator-detail")
        }
    }, [address])

    // Load all validator data
    const load = useCallback(async () => {
        if (!address) return
        abortRef.current?.abort()
        const ctrl = new AbortController()
        abortRef.current = ctrl

        try {
            const [allValidators, networkStats, csData, sigMap, monitoringMap] = await Promise.all([
                getValidators(GNO_RPC_URL),
                getNetworkStats(GNO_RPC_URL),
                getConsensusState(rpcUrl, ctrl.signal),
                fetchLastBlockSignatures(GNO_RPC_URL, 100),
                fetchAllMonitoringData(ctrl.signal),
            ])

            if (ctrl.signal.aborted) return

            // Merge monitoring data into validators
            const enriched = mergeWithMonitoringData(allValidators, monitoringMap)

            if (ctrl.signal.aborted) return

            const found = enriched.find(
                v => v.gnoAddr?.toLowerCase() === address.toLowerCase() ||
                     v.address?.toLowerCase() === address.toLowerCase()
            )

            if (!found) { setNotFound(true); setLoading(false); return }

            // Attach per-validator block signatures + compute health
            const sigKey = found.gnoAddr?.toLowerCase() || found.address?.toLowerCase() || ""
            const sigs = sigMap.get(sigKey) ?? []
            const withSigs = { ...found, lastBlockSignatures: sigs }
            const healthMeta = computeHealthStatus(withSigs)
            setValidator({ ...withSigs, healthStatus: healthMeta.status, healthMeta })
            setStats(networkStats)
            setCs(csData)

            // Heatmap for this specific validator (network-wide signing health)
            const height = csData?.height ?? networkStats.blockHeight
            if (height > 1) {
                const blocks = await fetchBlockHeatmap(rpcUrl, height, 100, ctrl.signal)
                if (!ctrl.signal.aborted) setHeatmap(blocks)
            }
        } catch {
            // resilient
        } finally {
            if (!ctrl.signal.aborted) setLoading(false)
        }
    }, [address, rpcUrl])

    useEffect(() => {
        load()

        // 2s consensus poll for live proposer badge
        const abortCs = new AbortController()
        const interval = setInterval(async () => {
            if (!isVisible.current) return
            const data = await getConsensusState(rpcUrl, abortCs.signal)
            if (data && !abortCs.signal.aborted) setCs(data)
        }, CONSENSUS_POLL_MS)

        return () => {
            clearInterval(interval)
            abortCs.abort()
            abortRef.current?.abort()
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [address])

    // Derived — use per-validator signing history for accurate per-validator stats
    const moniker = validator?.moniker || truncateValidatorAddr(address || "")
    const isProposer = cs?.proposer
        ? (validator?.address && cs.proposer.toUpperCase().includes(validator.address.toUpperCase().slice(0, 8)))
        : false

    // Per-validator block signatures (true=signed, false=missed)
    const sigs = validator?.lastBlockSignatures ?? []
    const missedLast = sigs.length > 0 ? sigs.filter(s => !s).length : null
    const signedLast = sigs.length > 0 ? sigs.filter(s => s).length : null
    const uptimeCalc = sigs.length > 0
        ? ((signedLast! / sigs.length) * 100).toFixed(1)
        : null

    // Page title
    useEffect(() => {
        document.title = moniker ? `${moniker} — Validator — Memba` : "Validator — Memba"
        return () => { document.title = "Memba" }
    }, [moniker])

    // ── Render: loading ──────────────────────────────────────
    if (loading) {
        return (
            <div className="vd-page">
                <div className="vd-nav">
                    <Link to="/validators" className="vd-back">← Validators</Link>
                </div>
                <div className="vd-loading">
                    <span className="hk-pulse" />
                    <span>Loading validator data…</span>
                </div>
            </div>
        )
    }

    // ── Render: 404 ──────────────────────────────────────────
    if (notFound || !validator) {
        return (
            <div className="vd-page">
                <div className="vd-nav">
                    <Link to="/validators" className="vd-back">← Validators</Link>
                </div>
                <div className="vd-notfound">
                    <span className="vd-notfound__icon">⚠</span>
                    <h2>Validator not found</h2>
                    <p className="vd-mono">{address}</p>
                    <p>This address is not in the active validator set on <strong>{GNO_CHAIN_ID}</strong>.</p>
                    <Link to="/validators" className="vd-btn-back">← Back to Validators</Link>
                </div>
            </div>
        )
    }

    // ── Render: full detail ──────────────────────────────────
    return (
        <div className="vd-page" data-testid="validator-detail-page">

            {/* ── Breadcrumb ─────────────────────────────── */}
            <div className="vd-nav">
                <Link to="/validators" className="vd-back">← Validators</Link>
                <span className="vd-nav__sep">/</span>
                <span className="vd-nav__current">{moniker}</span>
                <span className="vd-nav__chain">{GNO_CHAIN_ID}</span>
            </div>

            {/* ── Header card ────────────────────────────── */}
            <div className="vd-header-card">
                <div className="vd-header-card__left">
                    <span className={`vd-rank-badge ${validator.rank <= 3 ? "vd-rank-badge--top3" : ""}`}>
                        #{validator.rank}
                    </span>
                    <div className="vd-header-card__info">
                        <h1 className="vd-moniker">{moniker}</h1>
                        <span className="vd-gno-addr vd-mono">
                            {validator.gnoAddr || validator.address}
                            <CopyBtn text={validator.gnoAddr || validator.address} />
                        </span>
                    </div>
                </div>
                <div className="vd-header-card__right">
                    {isProposer && (
                        <span className="vd-badge vd-badge--proposer">⚡ Proposer</span>
                    )}
                    <span className={`vd-badge vd-badge--health ${healthCssClass(validator.healthStatus)}`}
                          title={validator.healthMeta?.reason || ""}>
                        {healthIcon(validator.healthStatus)} {healthLabel(validator.healthStatus)}
                    </span>
                </div>
            </div>

            {/* ── Stats grid ─────────────────────────────── */}
            <div className="vd-stats-grid">
                <div className="vd-stat-card">
                    <span className="vd-stat-label">Voting Power</span>
                    <span className="vd-stat-value vd-mono">{formatVotingPower(validator.votingPower)}</span>
                    {stats && <PowerBar percent={validator.powerPercent} />}
                </div>
                <div className="vd-stat-card">
                    <span className="vd-stat-label">Network Share</span>
                    <span className="vd-stat-value">{validator.powerPercent.toFixed(2)}%</span>
                    <span className="vd-stat-hint">of total voting power</span>
                </div>
                <div className="vd-stat-card">
                    <span className="vd-stat-label">Proposer Priority</span>
                    <span className="vd-stat-value vd-mono">{validator.proposerPriority.toLocaleString()}</span>
                    <span className="vd-stat-hint">higher = proposed sooner</span>
                </div>
                <div className="vd-stat-card">
                    <span className="vd-stat-label">Start Time</span>
                    <span className="vd-stat-value">{formatRelativeTime(validator.startTime)}</span>
                    <span className="vd-stat-hint">{validator.startTime ? new Date(validator.startTime).toLocaleDateString() : "—"}</span>
                </div>
                {validator.missedBlocks != null && (
                    <div className="vd-stat-card">
                        <span className="vd-stat-label">Missed Blocks</span>
                        <span className={`vd-stat-value vd-mono ${validator.missedBlocks >= 30 ? "vd-val-critical" : validator.missedBlocks >= 5 ? "vd-val-warn" : "vd-val-ok"}`}>
                            {validator.missedBlocks}
                        </span>
                        <span className="vd-stat-hint">this period</span>
                    </div>
                )}
            </div>

            {/* ── Identity panel ───────────────────── */}
            <div className="vd-card">
                <div className="vd-card__title">🪪 Identity</div>
                <AddrRow label="bech32 address" value={validator.gnoAddr || validator.address} />
                {/* Show raw hex only if it differs from gnoAddr (standard Tendermint chains) */}
                {validator.address && validator.address !== validator.gnoAddr && (
                    <AddrRow label="raw address" value={validator.address} />
                )}
                <AddrRow label="pubkey" value={validator.pubkey} />
                <div className="vd-row">
                    <span className="vd-row__label">pubkey type</span>
                    <span className="vd-row__value">{validator.pubkeyType.replace("tendermint/PubKey", "") || "Ed25519"}</span>
                </div>
                {validator.profileUrl && (
                    <div className="vd-row">
                        <span className="vd-row__label">gnoweb profile</span>
                        <a href={validator.profileUrl} target="_blank" rel="noopener noreferrer" className="vd-link vd-row__value">
                            View on Gnoweb ↗
                        </a>
                    </div>
                )}
            </div>

            {/* ── Performance ────────────────────────────── */}
            {sigs.length > 0 && (
                <div className="vd-card">
                    <div className="vd-card__title">📊 Performance (last {sigs.length} blocks)</div>
                    <div className="vd-perf-grid">
                        <div className="vd-perf-item">
                            <span className="vd-perf-label">Signed</span>
                            <span className="vd-perf-value vd-perf-value--ok">{signedLast}</span>
                        </div>
                        <div className="vd-perf-item">
                            <span className="vd-perf-label">Missed</span>
                            <span className={`vd-perf-value ${missedLast! > 2 ? "vd-perf-value--warn" : "vd-perf-value--ok"}`}>
                                {missedLast}
                            </span>
                        </div>
                        <div className="vd-perf-item">
                            <span className="vd-perf-label">Uptime</span>
                            <span className={`vd-perf-value ${Number(uptimeCalc) >= 99 ? "vd-perf-value--ok" : Number(uptimeCalc) >= 90 ? "vd-perf-value--warn" : "vd-perf-value--bad"}`}>
                                {uptimeCalc}%
                            </span>
                        </div>
                        {validator.participationRate != null && (
                            <div className="vd-perf-item">
                                <span className="vd-perf-label">Participation</span>
                                <span className="vd-perf-value">{validator.participationRate}%</span>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* ── Incident History (v2.17.0) ───────────────── */}
            {validator.incidents && validator.incidents.length > 0 && (
                <div className="vd-card">
                    <div className="vd-card__title">🚨 Incident History ({validator.incidents.length})</div>
                    <div className="vd-incident-timeline">
                        {[...validator.incidents]
                            .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
                            .slice(0, 10)
                            .map((inc, i) => (
                                <div key={i} className="vd-incident-row">
                                    <span className={`val-incident-badge val-incident-badge--${inc.severity.toLowerCase()}`}>
                                        {inc.severity}
                                    </span>
                                    <span className="vd-incident-time">
                                        {inc.timestamp ? new Date(inc.timestamp).toLocaleString() : "—"}
                                    </span>
                                    <span className="vd-incident-details">{inc.details}</span>
                                </div>
                            ))}
                    </div>
                </div>
            )}

            {/* ── Signature heatmap ──────────────────────── */}
            <BlockHeatmap
                blocks={heatmap}
                loading={loading}
                totalValidators={stats?.totalValidators}
            />

            {/* ── Links ──────────────────────────────────── */}
            <div className="vd-card vd-links">
                <div className="vd-card__title">🔗 External Links</div>
                {validator.profileUrl && (
                    <a href={validator.profileUrl} target="_blank" rel="noopener noreferrer" className="vd-ext-link">
                        <span>🌐 Gnoweb r/gnoland/valopers</span>
                        <span className="vd-ext-link__arrow">↗</span>
                    </a>
                )}
                <Link to="/validators/hacker" className="vd-ext-link">
                    <span>🕵️ Hacker view — Live network telemetry</span>
                    <span className="vd-ext-link__arrow">→</span>
                </Link>
                <Link to="/validators" className="vd-ext-link">
                    <span>← All Validators</span>
                    <span className="vd-ext-link__arrow">→</span>
                </Link>
            </div>
        </div>
    )
}
