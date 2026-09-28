/**
 * ValidatorsHacker — dedicated "/validators/hacker" page.
 *
 * Gnockpit-parity+ live telemetry dashboard with:
 * - Persistent top status bar (block height, sync status, peer count, last updated)
 * - CONNECT section (seed address + genesis hash, click-to-copy)
 * - NETWORK STATE grid (chain metadata + live consensus + voting power + peers)
 * - CONSENSUS STATE widget (height/round, precommits, quorum, fault tolerance — gnomonitoring chain health)
 * - RECENT BLOCKS heatmap (100-block signing health)
 * - VALIDATOR HEALTH summary (per-validator: health, participation, uptime, missed, txContrib)
 * - PEERS table (topology with RPC status badges, validator-only filter)
 * - DOCTOR panel (derived diagnostics + monitoring incidents)
 * - NODE STATE panel (all fields from /status + session age)
 *
 * Independent from /validators — has its own polling lifecycle.
 * All intervals are cleaned up on unmount via AbortController.
 *
 * RPC Strategy:
 * - Uses getTelemetryRpcUrl() which prefers SAMOURAI_SENTRY_RPC_URL if configured
 * - Falls back to GNO_RPC_URL on any error
 *
 * All telemetry fetchers return null on failure (resilient, no crashes).
 */

import { useState, useEffect, useCallback, useRef, useMemo } from "react"
import { Link } from "react-router-dom"
import { useNetworkPath } from "../hooks/useNetworkNav"
import { useWindowActive } from "../os/page/WindowActivity"
import { GNO_CHAIN_ID, getTelemetryRpcUrl, getTelemetryRpcUrls } from "../lib/config"
import {
    getAggregatedNetPeers,
    getMempoolStatus,
    fetchBlockHeatmap,
    getNodeStatus,
    getValidatorRpcSnapshot,
    getNetworkStats,
    getValidators,
    mergeWithMonitoringData,
    fetchValoperMonikers,
    mergeValoperMonikers,
    type NetInfo,
    type BlockSample,
    type NodeStatus,
    type NetworkStats,
    type ValidatorInfo,
    type ValidatorRpcSnapshot,
} from "../lib/validators"
import {
    fetchMonitoringIncidents,
    fetchAllMonitoringData,
    type MonitoringIncident,
} from "../lib/gnomonitoring"
import { computeHealthStatus } from "../lib/validatorHealth"
import { fetchChainHealth, buildConsensusView, type ConsensusView } from "../lib/chainHealthApi"

import { HackerStatusBar } from "../components/validators/HackerStatusBar"
import { ConnectSection } from "../components/validators/ConnectSection"
import { ConsensusWidget } from "../components/validators/ConsensusWidget"
import { NetworkStateGrid } from "../components/validators/NetworkStateGrid"
import { BlockHeatmap } from "../components/validators/BlockHeatmap"
import { PeerTable } from "../components/validators/PeerTable"
import { DoctorPanel } from "../components/validators/DoctorPanel"
import { NodeStatePanel } from "../components/validators/NodeStatePanel"
import { ValidatorHealthGrid } from "../components/validators/ValidatorHealthGrid"

import "../components/validators/hacker-mode.css"
import "./validators-hacker.css"

// ── Polling intervals ──────────────────────────────────────────────────
// 5s: gnomonitoring's chain-health view, which is what actually feeds every
// live telemetry panel now. Matches that client's cache TTL, so a faster cadence here
// would only re-read the same cached value.
const CHAIN_HEALTH_MS = 5_000
const PEERS_MS = 15_000          // 15s: peer topology
const HEATMAP_MS = 30_000        // 30s: block heatmap (aligns with standard page)
const INCIDENTS_MS = 30_000      // 30s: monitoring incidents refresh
const MONITORING_MS = 60_000     // 60s: per-validator monitoring data
const NODESTATUS_MS = 60_000     // 60s: node identity (rarely changes)

export default function ValidatorsHacker() {
    const np = useNetworkPath()
    const windowActive = useWindowActive()
    const rpcUrl = getTelemetryRpcUrl()
    // Peer topology is aggregated across all trusted nodes: /net_info is
    // node-local, so a single RPC misses most of the network (the "missing
    // peers" bug). useMemo keeps the array reference stable across renders.
    const telemetryRpcUrls = useMemo(() => getTelemetryRpcUrls(), [])
    const [documentVisible, setDocumentVisible] = useState(() => document.visibilityState === "visible")
    const samplingActive = windowActive && documentVisible
    const mainAbort = useRef<AbortController | null>(null)
    // One in-flight pass per loop. Without this the intervals STACK: the heatmap
    // pass alone issues 100 /block calls in 10 sequential chunks at an 8s
    // per-call timeout, so a degraded RPC makes one pass take up to 80s while a
    // new pass starts every 30s. On mainnet there is one primary and a single
    // fallback, so stacked passes land on the same one or two hosts — a
    // self-inflicted DoS that gets worse exactly when the chain is already
    // struggling.
    const heatmapInFlight = useRef(false)
    const latestHeightRef = useRef<number>(0) // tracks height without setState for heatmap interval

    // ── State ──────────────────────────────────────────────────
    // Live consensus view: gnomonitoring's server-side parse of the chain's
    // consensus state. It feeds the consensus card, status bar, network-state
    // grid, heatmap and doctor. The client-side /dump_consensus_state reader it
    // replaced threw on every chain, so none of them had ever received real data.
    const [consensusView, setConsensusView] = useState<ConsensusView | null>(null)
    const [netInfo, setNetInfo] = useState<NetInfo | null>(null)
    const [blockHeatmap, setBlockHeatmap] = useState<BlockSample[]>([])
    const [heatmapSampleAt, setHeatmapSampleAt] = useState<number | null>(null)
    const [nodeStatus, setNodeStatus] = useState<NodeStatus | null>(null)
    const [networkStats, setNetworkStats] = useState<NetworkStats | null>(null)
    const [incidents, setIncidents] = useState<MonitoringIncident[]>([])
    const [incidentSampleAt, setIncidentSampleAt] = useState<number | null>(null)
    const [validators, setValidators] = useState<ValidatorInfo[]>([])
    const [mempoolCount, setMempoolCount] = useState<number | null>(null)
    const [mempoolSampleAt, setMempoolSampleAt] = useState<number | null>(null)
    const [lastUpdated, setLastUpdated] = useState<number | null>(null)
    const [loading, setLoading] = useState(true)
    const [loadError, setLoadError] = useState<string | null>(null)
    const [monitoringLoading, setMonitoringLoading] = useState(true)
    const [monitoringReachable, setMonitoringReachable] = useState<boolean | null>(null)
    const [rpcSampleAt, setRpcSampleAt] = useState<number | null>(null)
    const [peerSampleAt, setPeerSampleAt] = useState<number | null>(null)
    const [monitoringSampleAt, setMonitoringSampleAt] = useState<number | null>(null)
    const [clockNow, setClockNow] = useState(() => Date.now())
    // Lazy initializer — Date.now() during render is impure (react-hooks/purity)
    const [sessionStart] = useState(() => Date.now())

    // Compute session age string for NodeStatePanel. W4 (react-hooks/purity):
    // derived purely from state — before the first poll lands (lastUpdated
    // null) the age is simply 0; the old Date.now() fallback made render
    // impure for a value that was about to be replaced anyway.
    const sessionAgeMs = (lastUpdated ?? sessionStart) - sessionStart
    const sessionAgeStr = (() => {
        const s = Math.floor(sessionAgeMs / 1000)
        const m = Math.floor(s / 60) % 60
        const h = Math.floor(s / 3600)
        if (h > 0) return `${h}h ${m}m`
        if (m > 0) return `${m}m ${s % 60}s`
        return `${s}s`
    })()

    // ── Page Visibility API ────────────────────────────────────
    useEffect(() => {
        const handleVisibility = () => setDocumentVisible(document.visibilityState === "visible")
        document.addEventListener("visibilitychange", handleVisibility)
        return () => document.removeEventListener("visibilitychange", handleVisibility)
    }, [])

    useEffect(() => {
        if (!samplingActive) return
        const timer = window.setInterval(() => setClockNow(Date.now()), 5_000)
        return () => window.clearInterval(timer)
    }, [samplingActive])

    // ── Page Title ─────────────────────────────────────────────
    useEffect(() => {
        document.title = "Hacker View — Validators — Memba"
        return () => { document.title = "Memba" }
    }, [])

    // Bootstrap and the 30s interval share a slot: a degraded node must not
    // receive two overlapping 100-block heatmap bursts.
    const sampleHeatmap = useCallback(async (height: number, signal: AbortSignal, snapshot?: ValidatorRpcSnapshot) => {
        if (height <= 1 || heatmapInFlight.current) return
        heatmapInFlight.current = true
        try {
            const selected = snapshot ?? await getValidatorRpcSnapshot(signal)
            const blocks = await fetchBlockHeatmap(rpcUrl, height, 100, signal, 10, selected)
            if (!signal.aborted) {
                setBlockHeatmap(blocks)
                setHeatmapSampleAt(Date.now())
            }
        } catch (error) {
            if (!signal.aborted) setHeatmapSampleAt(null)
            throw error
        } finally {
            heatmapInFlight.current = false
        }
    }, [rpcUrl])

    // ── Initial full data load ─────────────────────────────────────
    // v2.17.2: Single parallel burst — eliminates sequential waterfall
    const loadAll = useCallback(async () => {
        mainAbort.current?.abort()
        const ctrl = new AbortController()
        mainAbort.current = ctrl
        setLoadError(null)
        setRpcSampleAt(null)
        setPeerSampleAt(null)

        // These sources are independent of the RPC roster. Start them before
        // the slower roster burst so one failed endpoint cannot block the live
        // consensus and peer panels.
        void getAggregatedNetPeers(telemetryRpcUrls, ctrl.signal)
            .then(ni => {
                if (ctrl.signal.aborted) return
                setNetInfo(ni)
                setPeerSampleAt(ni ? Date.now() : null)
            })
            .catch(() => { if (!ctrl.signal.aborted) { setNetInfo(null); setPeerSampleAt(null) } })
        void fetchChainHealth(ctrl.signal)
            .then(h => {
                if (ctrl.signal.aborted) return
                const usable = h?.rpcReachable && !h.isDisabled
                setConsensusView(usable ? buildConsensusView(h) : null)
                if (usable && h.latestBlockHeight) latestHeightRef.current = h.latestBlockHeight
            })
            .catch(() => { if (!ctrl.signal.aborted) setConsensusView(null) })

        try {
            const snapshot = await getValidatorRpcSnapshot(ctrl.signal)
            // Optional sources may fail independently. Keep successful samples
            // instead of discarding the entire cockpit on one rejected promise.
            const [nsResult, statsResult, valResult, monikerResult, incidentsResult, monitoringResult] = await Promise.allSettled([
                getNodeStatus(rpcUrl, ctrl.signal, snapshot),
                getNetworkStats(rpcUrl, undefined, ctrl.signal, snapshot),
                getValidators(rpcUrl, snapshot, ctrl.signal),
                fetchValoperMonikers(rpcUrl, snapshot, ctrl.signal),
                fetchMonitoringIncidents(ctrl.signal),   // v2.17.2: was sequential
                fetchAllMonitoringData(ctrl.signal),     // v2.17.2: was sequential
            ])

            if (ctrl.signal.aborted) return
            const nsData = nsResult.status === "fulfilled" ? nsResult.value : null
            const statsData = statsResult.status === "fulfilled" ? statsResult.value : null
            const valData = valResult.status === "fulfilled" ? valResult.value : null
            const valoperMap = monikerResult.status === "fulfilled" ? monikerResult.value : new Map<string, string>()
            const incidentsData = incidentsResult.status === "fulfilled" ? incidentsResult.value : null
            const monitoringData = monitoringResult.status === "fulfilled" && monitoringResult.value
                ? monitoringResult.value : new Map()
            setNodeStatus(nsData)
            setNetworkStats(statsData)
            setRpcSampleAt(statsData ? Date.now() : null)
            if (incidentsData) {
                setIncidents(incidentsData)
                setIncidentSampleAt(Date.now())
            } else setIncidentSampleAt(null)
            if (statsData) setLastUpdated(Date.now())
            if (!statsData && !valData) setLoadError("RPC samples unavailable. Retrying live telemetry.")

            // Track latest height via ref for heatmap interval
            const height = statsData?.blockHeight ?? 0
            if (!latestHeightRef.current) latestHeightRef.current = height

            // Heatmap: fire-and-forget after initial render (needs height)
            void sampleHeatmap(height, ctrl.signal, snapshot).catch(() => { /* unavailable until next sample */ })

            // v2.17.2: Apply valopers monikers (primary) + monitoring data + health
            if (valData) {
                const withMonikers = mergeValoperMonikers(valData, valoperMap)
                let merged = mergeWithMonitoringData(withMonikers, monitoringData)
                merged = merged.map(v => {
                    const healthMeta = computeHealthStatus(v)
                    return { ...v, healthStatus: healthMeta.status, healthMeta }
                })
                setValidators(merged)
                setMonitoringSampleAt(Date.now())
                setMonitoringLoading(false)
                // v2.17.2: Track monitoring API reachability for HackerStatusBar
                const hasMonData = merged.some(v => v.participationRate != null || v.uptimePercent != null)
                setMonitoringReachable(hasMonData)
            }
            setMonitoringLoading(false)
        } catch (err) {
            if (!ctrl.signal.aborted) {
                setLoadError(err instanceof Error ? err.message : "Failed to load validator data")
            }
        } finally {
            if (!ctrl.signal.aborted) setLoading(false)
        }
    }, [rpcUrl, telemetryRpcUrls, sampleHeatmap])

    // ── Mount: initial load + independent polling intervals ────
    // Waived, not converted: this page is a deliberately hand-tuned telemetry
    // cockpit running FOUR polling loops at different cadences (consensus 2s,
    // mempool 10s, peers 15s, full reload) over shared abort + visibility
    // infrastructure. Porting it to queries is a dedicated redesign with no
    // user-visible gain; the setStates ARE the telemetry stream.
    useEffect(() => {
        if (!samplingActive) {
            mainAbort.current?.abort()
            return
        }
        // A parked OS window and a hidden browser tab have the same lifecycle:
        // neither schedules telemetry. Each active period owns its own guards.
        const inFlight = new Set<string>()
        const guarded = (key: string, pass: () => Promise<void>) => async () => {
            if (inFlight.has(key)) return
            inFlight.add(key)
            try { await pass() }
            catch { /* a failed sample must not kill the loop */ }
            finally { inFlight.delete(key) }
        }
        // eslint-disable-next-line react-hooks/set-state-in-effect -- multi-cadence telemetry bootstrap
        loadAll()

        const abortCs = new AbortController()

        // Chain health: 5s — the live consensus source for every telemetry panel.
        // Server-side parsed by gnomonitoring against a stable contract, rather
        // than our own reader of a node-internal debug dump. It replaced a 2s
        // loop that issued two RPC calls per tick and never produced data.
        const chainHealthInterval = setInterval(guarded("chainhealth", async () => {
            const h = await fetchChainHealth(abortCs.signal)
            if (abortCs.signal.aborted) return
            const usable = h?.rpcReachable && !h.isDisabled
            setConsensusView(usable ? buildConsensusView(h) : null)
            if (usable) {
                if (h.latestBlockHeight) latestHeightRef.current = h.latestBlockHeight
                // The status bar's "Updated" readout means "last successful live
                // sample". The deleted 2s loop used to stamp it; this loop now
                // must, or the page would claim ever-staler data while polling fine.
                setLastUpdated(Date.now())
            }
        }), CHAIN_HEALTH_MS)

        // Mempool: 10s — pending transaction count
        const mempoolInterval = setInterval(guarded("mempool", async () => {
            const snapshot = await getValidatorRpcSnapshot(abortCs.signal)
            const data = await getMempoolStatus(rpcUrl, abortCs.signal, snapshot)
            if (!abortCs.signal.aborted) {
                setMempoolCount(data?.count ?? null)
                setMempoolSampleAt(data ? Date.now() : null)
            }
        }), 10_000)

        // Peers: 15s — aggregated across all trusted nodes (full topology)
        const peersInterval = setInterval(guarded("peers", async () => {
            const data = await getAggregatedNetPeers(telemetryRpcUrls, abortCs.signal)
            if (!abortCs.signal.aborted) {
                setNetInfo(data)
                setPeerSampleAt(data ? Date.now() : null)
            }
        }), PEERS_MS)

        // Heatmap: 30s — read height from ref (no nested setState)
        const heatmapInterval = setInterval(guarded("heatmap", async () => {
            const height = latestHeightRef.current
            if (height <= 1) return
            // Awaited, not fire-and-forget: the guard can only hold the slot for
            // work it can see finish, and this is the heaviest pass on the page.
            await sampleHeatmap(height, abortCs.signal)
        }), HEATMAP_MS)

        // Incidents: 30s (v2.17.1 — was one-shot)
        const incidentsInterval = setInterval(guarded("incidents", async () => {
            const data = await fetchMonitoringIncidents(abortCs.signal)
            if (abortCs.signal.aborted) return
            if (data) {
                setIncidents(data)
                setIncidentSampleAt(Date.now())
            } else setIncidentSampleAt(null)
        }), INCIDENTS_MS)

        // Monitoring data + health + monikers: 60s (v2.17.2: added valopers)
        const monitoringInterval = setInterval(guarded("monitoring", async () => {
            try {
                const snapshot = await getValidatorRpcSnapshot(abortCs.signal)
                const [valData, valoperMap, monData] = await Promise.all([
                    getValidators(rpcUrl, snapshot, abortCs.signal),
                    fetchValoperMonikers(rpcUrl, snapshot, abortCs.signal),
                    fetchAllMonitoringData(abortCs.signal),
                ])
                if (abortCs.signal.aborted) return
                if (valData) {
                    const withMonikers = mergeValoperMonikers(valData, valoperMap)
                    let merged = mergeWithMonitoringData(withMonikers, monData)
                    merged = merged.map(v => {
                        const healthMeta = computeHealthStatus(v)
                        return { ...v, healthStatus: healthMeta.status, healthMeta }
                    })
                    setValidators(merged)
                    setMonitoringSampleAt(Date.now())
                    setMonitoringLoading(false)
                    setMonitoringReachable(merged.some(v => v.participationRate != null || v.uptimePercent != null))
                    setLoadError(null)
                }
            } catch {
                if (abortCs.signal.aborted) return
                setMonitoringSampleAt(null)
                setMonitoringReachable(null)
            }
        }), MONITORING_MS)

        // Node status: 60s
        const nodeInterval = setInterval(guarded("nodestatus", async () => {
            const snapshot = await getValidatorRpcSnapshot(abortCs.signal)
            const [nodeResult, statsResult] = await Promise.allSettled([
                getNodeStatus(rpcUrl, abortCs.signal, snapshot),
                getNetworkStats(rpcUrl, undefined, abortCs.signal, snapshot),
            ])
            if (abortCs.signal.aborted) return
            setNodeStatus(nodeResult.status === "fulfilled" ? nodeResult.value : null)
            const stats = statsResult.status === "fulfilled" ? statsResult.value : null
            setNetworkStats(stats)
            setRpcSampleAt(stats ? Date.now() : null)
            if (stats) setLoadError(null)
        }), NODESTATUS_MS)

        return () => {
            clearInterval(chainHealthInterval)
            clearInterval(mempoolInterval)
            clearInterval(peersInterval)
            clearInterval(heatmapInterval)
            clearInterval(incidentsInterval)
            clearInterval(monitoringInterval)
            clearInterval(nodeInterval)
            abortCs.abort()
            mainAbort.current?.abort()
        }
    }, [rpcUrl, telemetryRpcUrls, samplingActive, loadAll, sampleHeatmap])

    const rpcFresh = samplingActive && rpcSampleAt !== null && clockNow - rpcSampleAt < 2 * NODESTATUS_MS
    const peersFresh = samplingActive && peerSampleAt !== null && clockNow - peerSampleAt < 2 * PEERS_MS
    const incidentsFresh = samplingActive && incidentSampleAt !== null && clockNow - incidentSampleAt < 2 * INCIDENTS_MS
    const monitoringFresh = samplingActive && monitoringSampleAt !== null && clockNow - monitoringSampleAt < 2 * MONITORING_MS
    const heatmapFresh = samplingActive && heatmapSampleAt !== null && clockNow - heatmapSampleAt < 2 * HEATMAP_MS
    const mempoolFresh = samplingActive && mempoolSampleAt !== null && clockNow - mempoolSampleAt < 20_000
    const currentStats = rpcFresh ? networkStats : null
    const currentPeers = peersFresh ? netInfo : null

    return (
        <div className="vh-page" data-testid="validators-hacker-page">
            {/* ── Navigation breadcrumb ──────────────────────── */}
            <div className="vh-nav">
                <Link to={np("validators")} className="vh-back">← Validators</Link>
                <span className="vh-nav__sep">/</span>
                <span className="vh-nav__current">🕵️ Hacker view</span>
                <span className="vh-nav__chain">{GNO_CHAIN_ID}</span>
            </div>

            {/* ── Persistent status bar ─────────────────────── */}
            <HackerStatusBar
                stats={currentStats}
                consensus={consensusView}
                netInfo={currentPeers}
                lastUpdated={lastUpdated}
                monitoringReachable={monitoringFresh ? monitoringReachable : null}
            />
            {samplingActive && ((!rpcFresh && networkStats) || (!peersFresh && netInfo)) && (
                <div className="hk-stale-notice" role="status">Live RPC or peer telemetry is stale. Historical values are hidden until a fresh sample arrives.</div>
            )}

            {/* ── Error state ───────────────────────────── */}
            {loadError && (
                <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", background: "rgba(244,67,54,0.08)", border: "1px solid rgba(244,67,54,0.2)", borderRadius: 8, marginBottom: 12 }}>
                    <span style={{ color: "var(--color-status-error-alt)", fontSize: "var(--pro-small, 13px)", fontFamily: "var(--font-ui, JetBrains Mono, monospace)", flex: 1 }}>
                        {loadError}
                    </span>
                    <button
                        onClick={loadAll}
                        style={{ color: "var(--color-brand)", background: "none", border: "1px solid var(--color-brand)", borderRadius: 6, padding: "6px 14px", fontSize: "var(--pro-small, 12px)", cursor: "pointer", fontFamily: "var(--font-ui, JetBrains Mono, monospace)" }}
                    >
                        Retry
                    </button>
                </div>
            )}

            {/* ── Main Hacker Layout ──────────────────────── */}
            <div className="hk-layout">

                {/* Row 1: Connect + Network State + Consensus */}
                <ConnectSection nodeStatus={rpcFresh ? nodeStatus : null} />
                <NetworkStateGrid stats={currentStats} consensus={consensusView} peerCount={currentPeers?.peerCount} mempoolCount={rpcFresh && mempoolFresh ? mempoolCount : null} />
                <ConsensusWidget view={consensusView} loading={loading} />

                {/* Row 2: Recent Blocks (full width) */}
                <BlockHeatmap
                    blocks={rpcFresh && heatmapFresh ? blockHeatmap : []}
                    loading={loading}
                    totalValidators={consensusView?.valsetSize}
                />

                {/* Row 3: Validator Health Summary (full width, v2.17.1) */}
                <ValidatorHealthGrid
                    validators={monitoringFresh ? validators : []}
                    loading={monitoringLoading}
                />

                {/* Row 4: Peers (full width) */}
                <PeerTable
                    netInfo={currentPeers}
                    loading={loading}
                />

                {/* Row 5: Doctor (full width) */}
                <DoctorPanel
                    netInfo={currentPeers}
                    consensus={consensusView}
                    localHeight={consensusView?.height ?? currentStats?.blockHeight ?? 0}
                    incidents={incidentsFresh ? incidents : []}
                    incidentsAvailable={incidentsFresh}
                />

                {/* Row 6: Node State (full width) */}
                <NodeStatePanel nodeStatus={rpcFresh ? nodeStatus : null} loading={loading} sessionAge={sessionAgeStr} />
            </div>
        </div>
    )
}
