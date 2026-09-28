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
import { publicRpcLink } from "./nodeStateLinks"

interface PeerTableProps {
    netInfo: NetInfo | null
    loading: boolean
}

function isPrivateHost(host: string): boolean {
    const normalized = host.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "")
    const octets = normalized.split(".").map(Number)
    const privateIPv4 = octets.length === 4 && octets.every(n => Number.isInteger(n) && n >= 0 && n <= 255) && (
        octets[0] === 0 || octets[0] === 10 || octets[0] === 127 ||
        (octets[0] === 169 && octets[1] === 254) ||
        (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
        (octets[0] === 192 && octets[1] === 168)
    )
    return privateIPv4 || normalized === "localhost" || normalized.endsWith(".local") || normalized === "::1" ||
        (normalized.includes(":") && (normalized.startsWith("fe80:") || normalized.startsWith("fc") || normalized.startsWith("fd")))
}

export function PeerTable({ netInfo, loading }: PeerTableProps) {
    const [rpcPeersOnly, setRpcPeersOnly] = useState(false)
    const peers = netInfo?.peers ?? []
    const displayed = rpcPeersOnly
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
                                checked={rpcPeersOnly}
                                onChange={e => setRpcPeersOnly(e.target.checked)}
                            />
                            peers advertising RPC
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
                                        const rpcLink = publicRpcLink(peer.rpcAddr)
                                        return (
                                        <tr key={peer.nodeId || peer.ip}>
                                            <td className="hk-peers__moniker">
                                                {peer.moniker || <span className="hk-dimmed">unknown</span>}
                                            </td>
                                            <td className="hk-mono hk-dimmed">{peer.ip ? isPrivateHost(peer.ip) ? "Private address" : peer.ip : "—"}</td>
                                            <td>
                                                <span className={`hk-badge ${peer.isOutbound ? "hk-badge--out" : "hk-badge--in"}`}>
                                                    {peer.isOutbound ? "OUT" : "IN"}
                                                </span>
                                            </td>
                                            <td className="hk-dimmed">{peer.network || "—"}</td>
                                            <td className="hk-mono hk-dimmed" title={isPrivateHost(peer.ip) ? undefined : peer.nodeId}>
                                                {peer.nodeId ? `${peer.nodeId.slice(0, 10)}…` : "—"}
                                            </td>
                                            <td>
                                                {hasRpc ? (
                                                    rpcLink ? (
                                                        <a href={rpcLink} target="_blank" rel="noopener noreferrer"
                                                            className="hk-badge hk-badge--out">RPC address ↗</a>
                                                    ) : (
                                                        <span className="hk-badge hk-badge--dim">No dialable address</span>
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
