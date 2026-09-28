/**
 * HackerStatusBar — Gnockpit-style persistent top status strip.
 * Shows: Block height | RPC sync state | Peers | RPC sample | Validator metrics | Updated Xs ago.
 * Receives props from parent (no own polling — parent drives data).
 */

import type { NetworkStats, NetInfo } from "../../lib/validators"
import type { ConsensusView } from "../../lib/chainHealthApi"

interface HackerStatusBarProps {
    stats: NetworkStats | null
    /** Live consensus view from gnomonitoring chain health; null when unavailable. */
    consensus: ConsensusView | null
    netInfo: NetInfo | null
    lastUpdated: number | null // timestamp of last successful fetch
    /** Whether validator monitoring metrics were present in the last roster sample. */
    monitoringReachable?: boolean | null
}

function secondsAgo(ts: number | null): string {
    if (!ts) return "—"
    const diff = Math.round((Date.now() - ts) / 1000)
    return `${diff}s`
}

export function HackerStatusBar({ stats, consensus, netInfo, lastUpdated, monitoringReachable }: HackerStatusBarProps) {
    // Prefer the live consensus height (refreshed every 5s), fall back to stats.
    const blockHeight = consensus?.height ?? stats?.blockHeight
    const synced = stats ? !stats.catchingUp : null
    const peers = netInfo?.peers?.length ?? "—"

    return (
        <div className="hk-status-bar" role="banner" aria-label="Network live status">
            <span className="hk-status-bar__block">
                Block <strong>{blockHeight?.toLocaleString() ?? "—"}</strong>
            </span>

            <span className={`hk-status-bar__sync ${synced === null ? "" : synced ? "hk-status-bar__sync--ok" : "hk-status-bar__sync--warn"}`}>
                {synced === null ? "RPC status unavailable" : synced ? "RPC synced" : "RPC catching up"}
            </span>

            <span className="hk-status-bar__sep">·</span>

            <span className="hk-status-bar__peers">
                Peers: <strong>{peers}</strong>
            </span>

            <span className="hk-status-bar__sep">·</span>

            <span className="hk-status-bar__conn">
                <span className={`hk-status-bar__dot ${stats ? "hk-status-bar__dot--green" : ""}`} />
                {stats ? "RPC sample available" : "RPC sample unavailable"}
            </span>

            <span className="hk-status-bar__sep">·</span>

            {/* This prop reports the presence of validator metrics, not API reachability. */}
            <span className="hk-status-bar__conn" title="Validator monitoring metrics in the roster sample">
                <span className={`hk-status-bar__dot ${
                    monitoringReachable === true ? "hk-status-bar__dot--green"
                    : monitoringReachable === false ? "hk-status-bar__dot--red"
                    : ""
                }`} />
                {monitoringReachable === false ? "metrics unavailable" : "monitoring metrics"}
            </span>

            <span className="hk-status-bar__sep" style={{ marginLeft: "auto" }} />

            <span className="hk-status-bar__updated">
                Updated: {lastUpdated ? new Date(lastUpdated).toLocaleTimeString() : "—"}
                {lastUpdated && <span className="hk-status-bar__ago"> ({secondsAgo(lastUpdated)})</span>}
            </span>
        </div>
    )
}
