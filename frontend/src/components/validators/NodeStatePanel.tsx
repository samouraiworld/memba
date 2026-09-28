/**
 * NodeStatePanel — displays node identity fields available from public RPC.
 * Fields NOT available (OS/node-local only) are shown as N/A.
 * Source: /status response.
 */

import type { NodeStatus } from "../../lib/validators"
import { publicRpcLink } from "./nodeStateLinks"

interface NodeStatePanelProps {
    nodeStatus: NodeStatus | null
    loading: boolean
    /** Pre-computed session age string (e.g. "5m 30s") */
    sessionAge?: string
}

function NsRow({ label, value, link, mono = true }: { label: string; value: string; link?: string; mono?: boolean }) {
    return (
        <div className="nsg-row">
            <span className="nsg-label">{label}</span>
            <span className={`nsg-value ${mono ? "hk-mono" : ""}`}>
                {link ? (
                    <a href={link} target="_blank" rel="noopener noreferrer" className="hk-link">
                        {value} ↗
                    </a>
                ) : value}
            </span>
        </div>
    )
}

const NA = "N/A (node-local only)"
function val(v: string | undefined, fallback = "unknown"): string {
    return v || fallback
}

function nodeTime(value: string | undefined): string {
    if (!value) return "unknown"
    const time = new Date(value)
    return Number.isFinite(time.getTime()) ? time.toISOString() : "unknown"
}

export function NodeStatePanel({ nodeStatus, loading, sessionAge }: NodeStatePanelProps) {
    const title = nodeStatus?.moniker ? `NODE STATE · ${nodeStatus.moniker.toUpperCase()}` : "NODE STATE"

    if (!nodeStatus && !loading) {
        return (
            <div className="hk-card hk-nsg">
                <div className="hk-card__title">
                    <span className="hk-card__icon">⚙</span>
                    NODE STATE
                </div>
                <div className="hk-unavail">
                    <span className="hk-unavail__icon">⚠</span>
                    <span>Endpoint unavailable</span>
                    <span className="hk-unavail__hint">Node status requires a reachable RPC endpoint</span>
                </div>
            </div>
        )
    }

    const gnoVersion = nodeStatus?.version ?? "unknown"
    const githubLink = gnoVersion !== "unknown" && gnoVersion !== ""
        ? `https://github.com/gnolang/gno/releases/tag/${gnoVersion}`
        : undefined

    // A status response may expose a bind address or private endpoint. It is
    // useful diagnostic text, but cannot be a navigable public RPC link.
    const rpcAddrRaw = nodeStatus?.rpcAddr ?? ""
    const rpcLink = publicRpcLink(rpcAddrRaw)

    return (
        <div className={`hk-card hk-nsg hk-node-state ${loading ? "hk-card--loading" : ""}`}
            style={{ gridColumn: "1 / -1" }}>
            <div className="hk-card__title">
                <span className="hk-card__icon">⚙</span>
                {title}
                {loading && <span className="hk-pulse" aria-label="Updating…" />}
            </div>
            <div className="nsg-body">
                <div>
                    <NsRow label="moniker" value={val(nodeStatus?.moniker)} mono={false} />
                    <NsRow label="version" value={gnoVersion} link={githubLink} />
                    <NsRow label="node-id" value={val(nodeStatus?.nodeId)} />
                    <NsRow label="p2p address" value={val(nodeStatus?.listenAddr)} />
                    <NsRow label="rpc url" value={val(rpcAddrRaw)} link={rpcLink} />
                    <NsRow label="validator addr" value={val(nodeStatus?.validatorAddr)} />
                    <NsRow label="pubkey" value={val(nodeStatus?.pubkey)} />
                </div>
                <div>
                    {/* Note: /status returns latest_app_hash, not the genesis file sha256 */}
                    <NsRow label="app hash" value={val(nodeStatus?.genesisHash)} />
                    <NsRow label="catching up" value={nodeStatus ? (nodeStatus.catchingUp ? "yes" : "no") : "unknown"} mono={false} />
                    <NsRow label="session age" value={sessionAge ?? "—"} mono={false} />
                    <NsRow label="node time (UTC)" value={nodeTime(nodeStatus?.nodeTime)} />
                    <NsRow label="timeouts" value={NA} mono={false} />
                    <NsRow label="chain data" value={NA} mono={false} />
                    <NsRow label="process mem" value={NA} mono={false} />
                    <NsRow label="disk" value={NA} mono={false} />
                </div>
            </div>
        </div>
    )
}
