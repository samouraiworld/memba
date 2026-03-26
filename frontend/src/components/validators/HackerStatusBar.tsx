/**
 * HackerStatusBar — Gnockpit-style persistent top status strip.
 * Shows: Block height | synced/catching-up | Peers | connected dot | Monitoring API | Updated Xs ago.
 * Receives props from parent (no own polling — parent drives data).
 */

import type { NetworkStats, NetInfo, HackerConsensusState } from "../../lib/validators"

interface HackerStatusBarProps {
    stats: NetworkStats | null
    cs: HackerConsensusState | null
    netInfo: NetInfo | null
    lastUpdated: number | null // timestamp of last successful fetch
    /** Whether the gnomonitoring API is reachable (v2.17.2) */
    monitoringReachable?: boolean | null
}

function secondsAgo(ts: number | null): string {
    if (!ts) return "—"
    const diff = Math.round((Date.now() - ts) / 1000)
    return `${diff}s`
}

export function HackerStatusBar({ stats, cs, netInfo, lastUpdated, monitoringReachable }: HackerStatusBarProps) {
    // Prefer consensus-derived height (more frequent), fall back to networkStats
    const blockHeight = cs?.height ?? stats?.blockHeight
    const synced = stats ? !stats.catchingUp : null
    const peers = netInfo?.peers?.length ?? "—"

    return (
        <div className="hk-status-bar" role="banner" aria-label="Network live status">
            <span className="hk-status-bar__block">
                Block <strong>{blockHeight?.toLocaleString() ?? "—"}</strong>
            </span>

            <span className={`hk-status-bar__sync ${synced === null ? "" : synced ? "hk-status-bar__sync--ok" : "hk-status-bar__sync--warn"}`}>
                {synced === null ? "connecting…" : synced ? "synced" : "catching up"}
            </span>

            <span className="hk-status-bar__sep">·</span>

            <span className="hk-status-bar__peers">
                Peers: <strong>{peers}</strong>
            </span>

            <span className="hk-status-bar__sep">·</span>

            <span className="hk-status-bar__conn">
                <span className="hk-status-bar__dot" />
                connected
            </span>

            <span className="hk-status-bar__sep">·</span>

            {/* v2.17.2: Monitoring API health indicator */}
            <span className="hk-status-bar__conn" title="gnomonitoring API status">
                <span className={`hk-status-bar__dot ${
                    monitoringReachable === true ? "hk-status-bar__dot--green"
                    : monitoringReachable === false ? "hk-status-bar__dot--red"
                    : ""
                }`} />
                monitoring
            </span>

            <span className="hk-status-bar__sep" style={{ marginLeft: "auto" }} />

            <span className="hk-status-bar__updated">
                Updated: {lastUpdated ? new Date(lastUpdated).toLocaleTimeString() : "—"}
                {lastUpdated && <span className="hk-status-bar__ago"> ({secondsAgo(lastUpdated)})</span>}
            </span>
        </div>
    )
}
