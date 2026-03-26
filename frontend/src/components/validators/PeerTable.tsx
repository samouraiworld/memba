/**
 * PeerTable — connected peers display for Hacker Mode.
 *
 * Displays all peers from /net_info with moniker, IP, P2P address,
 * peer type (inbound vs outbound), and RPC status.
 *
 * Gracefully renders a "Peers unavailable" fallback when `netInfo` is null —
 * e.g. when /net_info is restricted by the node's config.
 */

import type { NetInfo } from "../../lib/validators"
import { useState } from "react"

interface PeerTableProps {
    netInfo: NetInfo | null
    loading: boolean
}

export function PeerTable({ netInfo, loading }: PeerTableProps) {
    const [validatorsOnly, setValidatorsOnly] = useState(false)
    const peers = netInfo?.peers ?? []
    const displayed = validatorsOnly
        ? peers.filter(p => p.rpcAddr && p.rpcAddr.length > 0)
        : peers
    return (
        <div className={`hk-card hk-peers ${loading && !netInfo ? "hk-card--loading" : ""}`} id="hk-peer-table">
            <div className="hk-card__title">
                <span className="hk-card__icon">⬡</span>
                PEERS
                {netInfo && (
                    <span className="hk-badge hk-badge--peers">
                        {netInfo.peerCount}
                    </span>
                )}
                {loading && <span className="hk-pulse" aria-label="Updating…" />}
            </div>

            {netInfo ? (
                <>
                    <div className="hk-peers__status">
                        <span className={`hk-dot ${netInfo.listening ? "hk-dot--green" : "hk-dot--red"}`} />
                        {netInfo.listening ? "Listening" : "Not listening"}
                        <label className="hk-peers__toggle" style={{ marginLeft: "auto" }}>
                            <input
                                type="checkbox"
                                checked={validatorsOnly}
                                onChange={e => setValidatorsOnly(e.target.checked)}
                            />
                            only validators
                        </label>
                    </div>

                    {netInfo.peers.length === 0 ? (
                        <div className="hk-unavail">No peers connected</div>
                    ) : (
                        <div className="hk-peers__table-wrap">
                            <table className="hk-peers__table" aria-label="Connected peers">
                                <thead>
                                    <tr>
                                        <th>Moniker</th>
                                        <th>IP</th>
                                        <th>Dir</th>
                                        <th>Network</th>
                                        <th>Node ID</th>
                                        <th>RPC</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {displayed.map((peer) => {
                                        const hasRpc = peer.rpcAddr && peer.rpcAddr.length > 0
                                        const rpcLink = hasRpc && !peer.rpcAddr.includes("0.0.0.0")
                                            ? `http://${peer.rpcAddr}` : undefined
                                        return (
                                        <tr key={peer.nodeId || peer.ip}>
                                            <td className="hk-peers__moniker">
                                                {peer.moniker || <span className="hk-dimmed">unknown</span>}
                                            </td>
                                            <td className="hk-mono hk-dimmed">{peer.ip || "—"}</td>
                                            <td>
                                                <span className={`hk-badge ${peer.isOutbound ? "hk-badge--out" : "hk-badge--in"}`}>
                                                    {peer.isOutbound ? "OUT" : "IN"}
                                                </span>
                                            </td>
                                            <td className="hk-dimmed">{peer.network || "—"}</td>
                                            <td className="hk-mono hk-dimmed" title={peer.nodeId}>
                                                {peer.nodeId ? `${peer.nodeId.slice(0, 10)}…` : "—"}
                                            </td>
                                            <td>
                                                {hasRpc ? (
                                                    rpcLink ? (
                                                        <a href={rpcLink} target="_blank" rel="noopener noreferrer"
                                                            className="hk-badge hk-badge--ok">OK rpc ↗</a>
                                                    ) : (
                                                        <span className="hk-badge hk-badge--warn">rpc-closed</span>
                                                    )
                                                ) : (
                                                    <span className="hk-badge hk-badge--dim">—</span>
                                                )}
                                            </td>
                                        </tr>
                                        )
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </>
            ) : (
                <div className="hk-unavail">
                    <span className="hk-unavail__icon">⚠</span>
                    Peer info unavailable for this RPC endpoint
                    <span className="hk-unavail__hint">/net_info may be restricted</span>
                </div>
            )}
        </div>
    )
}
