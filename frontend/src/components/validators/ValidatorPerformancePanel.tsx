/**
 * ValidatorPerformancePanel — the live performance/technical metrics for the unified
 * validator profile's "Performance" tab. Extracted from the old ValidatorDetail page so
 * a single component serves both the active-validator metrics and the honest
 * "not in the active set yet" state for registered candidates.
 *
 * Props:
 *   - signingAddress: the consensus/gnoAddr whose metrics to fetch.
 *   - isActive:       whether that address is in the live consensus set. When false
 *                     (a registered candidate, or no metrics available) the panel shows
 *                     the candidate explainer instead of fetching.
 *
 * Fetching is lazy by construction: the panel only mounts when the Performance tab is
 * opened, so the heavy per-block heatmap fan-out never runs on the default Overview view.
 */
import { useQuery } from "@tanstack/react-query"
import { GNO_RPC_URL, getTelemetryRpcUrl } from "../../lib/config"
import {
    getValidators,
    getNetworkStats,
    getConsensusState,
    fetchBlockHeatmap,
    fetchLastBlockSignatures,
    formatVotingPower,
    formatRelativeTime,
    mergeWithMonitoringData,
    type ValidatorInfo,
    type BlockSample,
} from "../../lib/validators"
import { fetchAllMonitoringData } from "../../lib/gnomonitoring"
import {
    computeHealthStatus,
    healthCssClass,
    healthLabel,
    healthIcon,
} from "../../lib/validatorHealth"
import { BlockHeatmap } from "./BlockHeatmap"

const CONSENSUS_POLL_MS = 2_000
const NO_SAMPLES: BlockSample[] = []

function PowerBar({ percent }: { percent: number }) {
    return (
        <div className="vd-power-bar-wrap">
            <div className="vd-power-bar-fill" style={{ width: `${Math.min(percent, 100)}%` }} />
            <span className="vd-power-bar-label">{percent.toFixed(2)}%</span>
        </div>
    )
}

/** Honest state for a registered valoper that isn't currently validating. */
function NotInActiveSet() {
    return (
        <div className="vd-card vp-perf-inactive" data-testid="vp-perf-inactive">
            <div className="vp-perf-inactive__icon" aria-hidden="true">◷</div>
            <h3 className="vp-perf-inactive__title">Not in the active validator set yet</h3>
            <p className="vp-perf-inactive__body">
                This operator is a registered valoper, but its signing key isn't in the current
                consensus set — so there are no live performance metrics to show yet. Voting power,
                uptime, and the signature heatmap appear here once it starts validating.
            </p>
        </div>
    )
}

export function ValidatorPerformancePanel({
    signingAddress,
    isActive,
}: {
    signingAddress: string
    isActive: boolean
}) {
    const rpcUrl = getTelemetryRpcUrl()

    // The full metrics load, keyed by validator. React Query hands the queryFn
    // an AbortSignal that fires on key change/unmount — the old manual
    // AbortController + abortRef dance, structurally.
    const perfEnabled = !!signingAddress && isActive
    const perfQuery = useQuery({
        queryKey: ["validators", "perf", signingAddress, rpcUrl],
        enabled: perfEnabled,
        queryFn: async ({ signal }) => {
            const [allValidators, csData, sigMap, monitoringMap] = await Promise.all([
                getValidators(GNO_RPC_URL),
                getConsensusState(rpcUrl, signal),
                fetchLastBlockSignatures(GNO_RPC_URL, 100),
                fetchAllMonitoringData(signal),
            ])
            const networkStats = await getNetworkStats(GNO_RPC_URL, allValidators)
            const enriched = mergeWithMonitoringData(allValidators, monitoringMap)
            const found = enriched.find(
                v => v.gnoAddr?.toLowerCase() === signingAddress.toLowerCase() ||
                     v.address?.toLowerCase() === signingAddress.toLowerCase(),
            )
            if (!found) {
                // Not in the enriched set — renders the metrics-unavailable
                // state, exactly like the old early return with null validator.
                return { validator: null, stats: networkStats, cs: csData, heatmap: [] as BlockSample[] }
            }
            const sigKey = found.gnoAddr?.toLowerCase() || found.address?.toLowerCase() || ""
            const withSigs = { ...found, lastBlockSignatures: sigMap.get(sigKey) ?? [] }
            const healthMeta = computeHealthStatus(withSigs)
            const height = csData?.height ?? networkStats.blockHeight
            const heatmap = height > 1 ? await fetchBlockHeatmap(rpcUrl, height, 100, signal) : []
            return {
                validator: { ...withSigs, healthStatus: healthMeta.status, healthMeta } as ValidatorInfo,
                stats: networkStats,
                cs: csData,
                heatmap,
            }
        },
    })

    // Live consensus refresh every CONSENSUS_POLL_MS. The shared client pins
    // refetchIntervalInBackground:false, which is the old isVisible-ref gate.
    const csQuery = useQuery({
        queryKey: ["validators", "consensus", rpcUrl],
        enabled: isActive,
        refetchInterval: CONSENSUS_POLL_MS,
        queryFn: ({ signal }) => getConsensusState(rpcUrl, signal),
    })

    const validator = perfQuery.data?.validator ?? null
    const stats = perfQuery.data?.stats ?? null
    const cs = csQuery.data ?? perfQuery.data?.cs ?? null
    const heatmap = perfQuery.data?.heatmap ?? NO_SAMPLES
    const loading = perfEnabled ? perfQuery.isPending : false
    const error = perfQuery.isError
        ? (perfQuery.error instanceof Error ? perfQuery.error.message : "Failed to load metrics")
        : null

    if (!isActive) return <NotInActiveSet />

    if (loading) {
        return (
            <div className="vd-loading" data-testid="vp-perf-loading">
                <span className="hk-pulse" />
                <span>Loading performance…</span>
            </div>
        )
    }

    if (error && !validator) {
        return (
            <div className="vd-card vp-empty" data-testid="vp-perf-error">
                <p>Couldn't load performance metrics.</p>
                <button className="vd-btn-back" style={{ marginTop: 10 }} onClick={() => void perfQuery.refetch()}>Retry</button>
            </div>
        )
    }

    if (!validator) {
        return (
            <div className="vd-card vp-empty" data-testid="vp-perf-unavailable">
                <p>No live metrics available for this signing address right now.</p>
            </div>
        )
    }

    const isProposer = cs?.proposer
        ? !!(validator.address && cs.proposer.toUpperCase().includes(validator.address.toUpperCase().slice(0, 8)))
        : false
    const sigs = validator.lastBlockSignatures ?? []
    const signedLast = sigs.length > 0 ? sigs.filter(s => s).length : null
    const missedLast = sigs.length > 0 ? sigs.filter(s => !s).length : null
    const uptimeCalc = sigs.length > 0 ? ((signedLast! / sigs.length) * 100).toFixed(1) : null

    return (
        <div data-testid="vp-perf-metrics" style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
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
                <div className="vd-stat-card">
                    <span className="vd-stat-label">Health</span>
                    <span className={`vd-badge vd-badge--health ${healthCssClass(validator.healthStatus)}`} title={validator.healthMeta?.reason || ""}>
                        {healthIcon(validator.healthStatus)} {healthLabel(validator.healthStatus)}
                    </span>
                    {isProposer && <span className="vd-stat-hint">⚡ proposing now</span>}
                </div>
            </div>

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
                            <span className={`vd-perf-value ${missedLast! > 2 ? "vd-perf-value--warn" : "vd-perf-value--ok"}`}>{missedLast}</span>
                        </div>
                        <div className="vd-perf-item">
                            <span className="vd-perf-label">Uptime</span>
                            <span className={`vd-perf-value ${Number(uptimeCalc) >= 99 ? "vd-perf-value--ok" : Number(uptimeCalc) >= 90 ? "vd-perf-value--warn" : "vd-perf-value--bad"}`}>{uptimeCalc}%</span>
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

            {validator.incidents && validator.incidents.length > 0 && (
                <div className="vd-card">
                    <div className="vd-card__title">🚨 Incident History ({validator.incidents.length})</div>
                    <div className="vd-incident-timeline">
                        {[...validator.incidents]
                            .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
                            .slice(0, 10)
                            .map((inc, i) => (
                                <div key={i} className="vd-incident-row">
                                    <span className={`val-incident-badge val-incident-badge--${inc.severity.toLowerCase()}`}>{inc.severity}</span>
                                    <span className="vd-incident-time">{inc.timestamp ? new Date(inc.timestamp).toLocaleString() : "—"}</span>
                                    <span className="vd-incident-details">{inc.details}</span>
                                </div>
                            ))}
                    </div>
                </div>
            )}

            <BlockHeatmap blocks={heatmap} loading={loading} totalValidators={stats?.totalValidators} />
        </div>
    )
}
