/**
 * NetworkStateGrid — dense Gnockpit-style network state display.
 *
 * Shows chain metadata (chain ID, AppHash, genesis, node uptime, sync status)
 * plus the recent 100-block heatmap strip.
 *
 * All fields degrade to "—" when data is null/unavailable.
 */

import type { NetworkStats } from "../../lib/validators"
import type { ConsensusView } from "../../lib/chainHealthApi"

interface NetworkStateGridProps {
    stats: NetworkStats | null
    /** Live consensus view from gnomonitoring chain health; null when unavailable. */
    consensus: ConsensusView | null
    /** Chain's seed address (optional, set via SAMOURAI_SENTRY or config) */
    seedAddr?: string
    /** Peer count from NetInfo (optional) */
    peerCount?: number
    /** Pending transaction count from mempool (optional) */
    mempoolCount?: number | null
}

function Row({ label, value, accent, mono }: {
    label: string
    value: React.ReactNode
    accent?: boolean
    mono?: boolean
}) {
    return (
        <div className="nsg-row">
            <span className="nsg-label">{label}</span>
            <span className={`nsg-value ${accent ? "hk-accent" : ""} ${mono ? "hk-mono" : ""}`}>
                {value ?? "—"}
            </span>
        </div>
    )
}

function blockTimeAgo(isoStr: string): string {
    if (!isoStr) return "—"
    const ms = Date.now() - new Date(isoStr).getTime()
    if (ms < 0 || isNaN(ms)) return "—"
    const s = Math.floor(ms / 1000)
    if (s < 60) return `${s}s ago`
    const m = Math.floor(s / 60)
    return `${m}m ago`
}

export function NetworkStateGrid({ stats, consensus, seedAddr, peerCount, mempoolCount }: NetworkStateGridProps) {
    const chainId = stats?.chainId || "—"
    const totalValidators = consensus?.valsetSize || stats?.totalValidators || null
    const totalVotingPower = consensus?.totalVotingPower || stats?.totalVotingPower || null

    return (
        <div className="hk-card hk-nsg" id="hk-network-state">
            <div className="hk-card__title">
                <span className="hk-card__icon">⬡</span>
                NETWORK STATE
                <span className={`hk-badge ${stats?.catchingUp ? "hk-badge--warn" : "hk-badge--ok"}`}>
                    {stats?.catchingUp ? "SYNCING" : "SYNCED"}
                </span>
            </div>

            <div className="nsg-body">
                {/* Left column — chain metadata */}
                <div className="nsg-col">
                    <Row label="block height" value={<strong>{stats?.blockHeight?.toLocaleString() ?? "—"}</strong>} />
                    <Row label="block time"
                        value={stats?.latestBlockTime
                            ? `${new Date(stats.latestBlockTime).toISOString().replace("T", " ").slice(0, 19)} UTC (${blockTimeAgo(stats.latestBlockTime)})`
                            : "—"}
                        mono />
                    <Row label="chain" value={chainId} accent />
                    {/* No genesis-time or app-hash rows. Genesis time is in no payload
                        this page fetches (the rows only ever showed a dash), and the
                        latest app hash is already displayed in CONNECT above. */}
                    {seedAddr && (
                        <Row label="seed" value={seedAddr} mono />
                    )}
                    {peerCount != null && (
                        <Row label="peers" value={peerCount} accent />
                    )}
                    {mempoolCount != null && (
                        <Row label="mempool" value={`${mempoolCount} pending tx${mempoolCount !== 1 ? "s" : ""}`} accent={mempoolCount > 0} />
                    )}
                </div>

                {/* Right column — consensus metadata */}
                <div className="nsg-col">
                    <Row label="avg block time" value={stats?.avgBlockTime != null ? `${stats.avgBlockTime.toFixed(1)}s` : "—"} />
                    {totalValidators != null && (
                        <Row label="valset" value={totalValidators} accent />
                    )}
                    {/* Quorum is VOTING POWER (tm2: TotalVotingPower*2/3 + 1). The row
                        it replaces showed `min bft` as a validator COUNT — the same
                        number only while every validator carries equal weight. */}
                    {consensus && consensus.totalVotingPower > 0 && (
                        <Row label="quorum (power)" value={`${consensus.quorum} of ${consensus.totalVotingPower}`} />
                    )}
                    {consensus && consensus.valsetSize > 0 && (
                        <Row
                            label="tolerates"
                            value={`${consensus.faultTolerance} failure${consensus.faultTolerance === 1 ? "" : "s"}`}
                            accent={consensus.faultTolerance >= 1}
                        />
                    )}
                    {totalVotingPower != null && totalVotingPower > 0 && (
                        <Row label="total voting power" value={totalVotingPower.toLocaleString()} accent />
                    )}
                </div>
            </div>
        </div>
    )
}
