/**
 * ValidatorsHacker — dedicated "/validators/hacker" page.
 *
 * Gnockpit-parity+ live telemetry dashboard with:
 * - Persistent top status bar (block height, sync status, peer count, last updated)
 * - CONNECT section (seed address + genesis hash, click-to-copy)
 * - NETWORK STATE grid (chain metadata + live consensus + voting power + peers)
 * - CONSENSUS STATE widget (H/R/S, proposer, vote bars, round age)
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

import { useState, useEffect, useCallback, useRef } from "react"
import { Link } from "react-router-dom"
import { GNO_CHAIN_ID, getTelemetryRpcUrl } from "../lib/config"
import {
    getConsensusState,
    getNetPeers,
    fetchBlockHeatmap,
    getNodeStatus,
    getNetworkStats,
    getValidators,
    mergeWithMonitoringData,
    type HackerConsensusState,
    type NetInfo,
    type BlockSample,
    type NodeStatus,
    type NetworkStats,
    type ValidatorInfo,
} from "../lib/validators"
import {
    fetchMonitoringIncidents,
    fetchAllMonitoringData,
    type MonitoringIncident,
} from "../lib/gnomonitoring"
import { computeHealthStatus } from "../lib/validatorHealth"

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
const CONSENSUS_MS = 2_000       // 2s: live H/R/S consensus state
const PEERS_MS = 15_000          // 15s: peer topology
const HEATMAP_MS = 30_000        // 30s: block heatmap (aligns with standard page)
const INCIDENTS_MS = 30_000      // 30s: monitoring incidents refresh
const MONITORING_MS = 60_000     // 60s: per-validator monitoring data
const NODESTATUS_MS = 60_000     // 60s: node identity (rarely changes)

export default function ValidatorsHacker() {
    const rpcUrl = getTelemetryRpcUrl()
    const isVisible = useRef(true)
    const mainAbort = useRef<AbortController | null>(null)
    const latestHeightRef = useRef<number>(0) // tracks height without setState for heatmap interval

    // ── State ──────────────────────────────────────────────────
    const [cs, setCs] = useState<HackerConsensusState | null>(null)
    const [netInfo, setNetInfo] = useState<NetInfo | null>(null)
    const [blockHeatmap, setBlockHeatmap] = useState<BlockSample[]>([])
    const [nodeStatus, setNodeStatus] = useState<NodeStatus | null>(null)
    const [networkStats, setNetworkStats] = useState<NetworkStats | null>(null)
    const [incidents, setIncidents] = useState<MonitoringIncident[]>([])
    const [validators, setValidators] = useState<ValidatorInfo[]>([])
    const [lastUpdated, setLastUpdated] = useState<number | null>(null)
    const [loading, setLoading] = useState(true)
    const [monitoringLoading, setMonitoringLoading] = useState(true)
    const [sessionStart] = useState(Date.now())

    // Compute session age string for NodeStatePanel (stable across re-renders via state)
    const sessionAgeMs = (lastUpdated ?? Date.now()) - sessionStart
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
        const handleVisibility = () => {
            isVisible.current = document.visibilityState === "visible"
        }
        document.addEventListener("visibilitychange", handleVisibility)
        return () => document.removeEventListener("visibilitychange", handleVisibility)
    }, [])

    // ── Page Title ─────────────────────────────────────────────
    useEffect(() => {
        document.title = "Hacker View — Validators — Memba"
        return () => { document.title = "Memba" }
    }, [])

    // ── Initial full data load ─────────────────────────────────────
    const loadAll = useCallback(async () => {
        mainAbort.current?.abort()
        const ctrl = new AbortController()
        mainAbort.current = ctrl

        try {
            const [csData, niData, nsData, statsData, valData] = await Promise.all([
                getConsensusState(rpcUrl, ctrl.signal),
                getNetPeers(rpcUrl, ctrl.signal),
                getNodeStatus(rpcUrl, ctrl.signal),
                getNetworkStats(rpcUrl, undefined, ctrl.signal),
                getValidators(rpcUrl),
            ])

            if (ctrl.signal.aborted) return

            setCs(csData)
            setNetInfo(niData)
            setNodeStatus(nsData)
            setNetworkStats(statsData)
            setLastUpdated(Date.now())

            // Track latest height via ref for heatmap interval (avoids nested setState)
            const height = csData?.height ?? statsData?.blockHeight ?? 0
            latestHeightRef.current = height

            // Heatmap: use consensus height first, fall back to stats height
            if (height > 1) {
                const heatmap = await fetchBlockHeatmap(rpcUrl, height, 100, ctrl.signal)
                if (!ctrl.signal.aborted) setBlockHeatmap(heatmap)
            }

            // v2.17.0: Fetch monitoring incidents for DoctorPanel
            const incidentsData = await fetchMonitoringIncidents(ctrl.signal)
            if (!ctrl.signal.aborted && incidentsData) setIncidents(incidentsData)

            // v2.17.1: Fetch all monitoring data + compute health for ValidatorHealthGrid
            const monitoringData = await fetchAllMonitoringData(ctrl.signal)
            if (!ctrl.signal.aborted && valData) {
                let merged = mergeWithMonitoringData(valData, monitoringData)
                merged = merged.map(v => {
                    const healthMeta = computeHealthStatus(v)
                    return { ...v, healthStatus: healthMeta.status, healthMeta }
                })
                setValidators(merged)
                setMonitoringLoading(false)
            }
        } catch {
            // Resilient — show partial data
        } finally {
            if (!ctrl.signal.aborted) setLoading(false)
        }
    }, [rpcUrl])

    // ── Mount: initial load + independent polling intervals ────
    useEffect(() => {
        loadAll()

        const abortCs = new AbortController()

        // Consensus: 2s — also update latestHeightRef
        const consensusInterval = setInterval(async () => {
            if (!isVisible.current) return
            const data = await getConsensusState(rpcUrl, abortCs.signal)
            if (data && !abortCs.signal.aborted) {
                setCs(data)
                if (data.height) latestHeightRef.current = data.height
                setLastUpdated(Date.now())
            }
        }, CONSENSUS_MS)

        // Peers: 15s
        const peersInterval = setInterval(async () => {
            if (!isVisible.current) return
            const data = await getNetPeers(rpcUrl, abortCs.signal)
            if (data && !abortCs.signal.aborted) setNetInfo(data)
        }, PEERS_MS)

        // Heatmap: 30s — read height from ref (no nested setState)
        const heatmapInterval = setInterval(async () => {
            if (!isVisible.current) return
            const height = latestHeightRef.current
            if (height > 1) {
                fetchBlockHeatmap(rpcUrl, height, 100, abortCs.signal)
                    .then(h => { if (!abortCs.signal.aborted) setBlockHeatmap(h) })
                    .catch(() => { /* resilient */ })
            }
        }, HEATMAP_MS)

        // Incidents: 30s (v2.17.1 — was one-shot)
        const incidentsInterval = setInterval(async () => {
            if (!isVisible.current) return
            const data = await fetchMonitoringIncidents(abortCs.signal)
            if (data && !abortCs.signal.aborted) setIncidents(data)
        }, INCIDENTS_MS)

        // Monitoring data + health: 60s (v2.17.1)
        const monitoringInterval = setInterval(async () => {
            if (!isVisible.current) return
            try {
                const [valData, monData] = await Promise.all([
                    getValidators(rpcUrl),
                    fetchAllMonitoringData(abortCs.signal),
                ])
                if (abortCs.signal.aborted) return
                if (valData) {
                    let merged = mergeWithMonitoringData(valData, monData)
                    merged = merged.map(v => {
                    const healthMeta = computeHealthStatus(v)
                    return { ...v, healthStatus: healthMeta.status, healthMeta }
                })
                    setValidators(merged)
                }
            } catch { /* resilient */ }
        }, MONITORING_MS)

        // Node status: 60s
        const nodeInterval = setInterval(async () => {
            if (!isVisible.current) return
            const data = await getNodeStatus(rpcUrl, abortCs.signal)
            if (data && !abortCs.signal.aborted) setNodeStatus(data)
        }, NODESTATUS_MS)

        return () => {
            clearInterval(consensusInterval)
            clearInterval(peersInterval)
            clearInterval(heatmapInterval)
            clearInterval(incidentsInterval)
            clearInterval(monitoringInterval)
            clearInterval(nodeInterval)
            abortCs.abort()
            mainAbort.current?.abort()
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [rpcUrl])

    return (
        <div className="vh-page" data-testid="validators-hacker-page">
            {/* ── Navigation breadcrumb ──────────────────────── */}
            <div className="vh-nav">
                <Link to="/validators" className="vh-back">← Validators</Link>
                <span className="vh-nav__sep">/</span>
                <span className="vh-nav__current">🕵️ Hacker view</span>
                <span className="vh-nav__chain">{GNO_CHAIN_ID}</span>
            </div>

            {/* ── Persistent status bar ─────────────────────── */}
            <HackerStatusBar
                stats={networkStats}
                cs={cs}
                netInfo={netInfo}
                lastUpdated={lastUpdated}
            />

            {/* ── Main Hacker Layout ──────────────────────── */}
            <div className="hk-layout">

                {/* Row 1: Connect + Network State + Consensus */}
                <ConnectSection nodeStatus={nodeStatus} />
                <NetworkStateGrid stats={networkStats} cs={cs} peerCount={netInfo?.peerCount} />
                <ConsensusWidget cs={cs} loading={loading} />

                {/* Row 2: Recent Blocks (full width) */}
                <BlockHeatmap
                    blocks={blockHeatmap}
                    loading={loading}
                    totalValidators={cs?.valsetSize}
                />

                {/* Row 3: Validator Health Summary (full width, v2.17.1) */}
                <ValidatorHealthGrid
                    validators={validators}
                    loading={monitoringLoading}
                />

                {/* Row 4: Peers (full width) */}
                <PeerTable
                    netInfo={netInfo}
                    loading={loading}
                />

                {/* Row 5: Doctor (full width) */}
                <DoctorPanel
                    netInfo={netInfo}
                    cs={cs}
                    localHeight={cs?.height ?? 0}
                    incidents={incidents}
                />

                {/* Row 6: Node State (full width) */}
                <NodeStatePanel nodeStatus={nodeStatus} loading={loading} sessionAge={sessionAgeStr} />
            </div>
        </div>
    )
}
