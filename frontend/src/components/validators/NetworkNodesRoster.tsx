/**
 * NetworkNodesRoster — full network node roster for the Validators page (Phase 2b).
 *
 * Peer-based, gnockpit-style: lists every reachable node from the aggregated
 * /net_info, tagged with a role (validator / sentry / rpc / snapshot / node).
 * Validators/valopers/peers can't be joined by address (three distinct address
 * spaces), so this complements — rather than replaces — the validator metrics
 * table above it, which carries VP / sign-rate / uptime for the consensus set.
 */

import { useState, useMemo } from "react"
import { buildNodeRoster, type NetInfo, type NodeRole } from "../../lib/validators"

const ROLE_LABEL: Record<NodeRole, string> = {
    validator: "Validator",
    sentry: "Sentry",
    rpc: "RPC",
    snapshot: "Snapshot",
    node: "Node",
}

interface NetworkNodesRosterProps {
    netInfo: NetInfo | null
    /** Lowercased valoper monikers — helps tag community validators by name. */
    validatorMonikers: Set<string>
    loading: boolean
}

export function NetworkNodesRoster({ netInfo, validatorMonikers, loading }: NetworkNodesRosterProps) {
    const [search, setSearch] = useState("")

    const roster = useMemo(
        () => buildNodeRoster(netInfo, validatorMonikers),
        [netInfo, validatorMonikers],
    )

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase()
        if (!q) return roster
        return roster.filter(r =>
            r.moniker.toLowerCase().includes(q) ||
            r.ip.includes(q) ||
            r.nodeId.toLowerCase().includes(q),
        )
    }, [roster, search])

    const validatorCount = roster.filter(r => r.role === "validator").length

    return (
        <div className="val-roster" id="network-nodes" data-testid="network-nodes-roster">
            <div className="val-roster__head">
                <div className="val-roster__title">
                    Network Nodes
                    {netInfo && <span className="val-roster__count">{roster.length}</span>}
                    {loading && !netInfo && <span className="val-roster__hint">loading…</span>}
                </div>
                <div className="val-roster__sub">
                    {netInfo
                        ? `Full P2P roster aggregated across trusted RPC nodes · ${validatorCount} validator${validatorCount === 1 ? "" : "s"}`
                        : "Peer topology unavailable right now"}
                </div>
            </div>

            {netInfo && roster.length > 0 && (
                <>
                    <input
                        type="text"
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder="Search nodes by name, IP, or node ID…"
                        className="val-search val-roster__search"
                        data-testid="roster-search"
                    />
                    <div className="val-roster__table-wrap">
                        <table className="val-roster__table" aria-label="Network nodes">
                            <thead>
                                <tr>
                                    <th>Name</th>
                                    <th>Role</th>
                                    <th>Node ID</th>
                                    <th>IP</th>
                                    <th title="How many of our RPC nodes see this peer">Seen</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filtered.map(row => (
                                    <tr key={row.nodeId || `${row.moniker}-${row.ip}`}>
                                        <td className="val-roster__name">
                                            {row.moniker || <span className="val-roster__dim">unknown</span>}
                                        </td>
                                        <td>
                                            <span className={`val-role-badge val-role-badge--${row.role}`}>
                                                {ROLE_LABEL[row.role]}
                                            </span>
                                        </td>
                                        <td className="val-mono val-roster__dim" title={row.nodeId}>
                                            {row.nodeId ? `${row.nodeId.slice(0, 12)}…` : "—"}
                                        </td>
                                        <td className="val-mono val-roster__dim">{row.ip || "—"}</td>
                                        <td className="val-roster__seen" title={`Seen by ${row.seenByCount} RPC node(s)`}>
                                            {row.seenByCount}×
                                        </td>
                                    </tr>
                                ))}
                                {filtered.length === 0 && (
                                    <tr>
                                        <td colSpan={5} className="val-roster__empty">No nodes match “{search}”.</td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </>
            )}

            {netInfo && roster.length === 0 && (
                <div className="val-roster__empty">No peers reported by any RPC node.</div>
            )}
        </div>
    )
}
