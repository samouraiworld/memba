/**
 * DoctorPanel — derives network health alerts from already-fetched data.
 * NO additional RPC calls — 100% derived from state passed by parent.
 *
 * Alert types:
 * - Peers with unknown/closed RPC
 * - Peers that are KO behind (height < localHeight - 2)
 * - Low peer count (< 3)
 * - Chain not advancing (gnomonitoring is_stuck)
 * - Consensus past round 0
 */

import type { NetInfo } from "../../lib/validators"
import type { ConsensusView } from "../../lib/chainHealthApi"
import type { MonitoringIncident } from "../../lib/gnomonitoring"

interface Diagnostic {
    type: "warn" | "error"
    message: string
    detail?: string
}

interface DoctorPanelProps {
    netInfo: NetInfo | null
    /** Live consensus view from gnomonitoring chain health; null when unavailable. */
    consensus: ConsensusView | null
    localHeight: number
    /** v2.17.0: monitoring incidents from gnomonitoring */
    incidents?: MonitoringIncident[]
}

function deriveDiagnostics(netInfo: NetInfo | null, consensus: ConsensusView | null, localHeight: number): Diagnostic[] {
    const diags: Diagnostic[] = []

    if (!netInfo && !consensus) return diags

    const peers = netInfo?.peers ?? []

    // Low peer count
    if (peers.length > 0 && peers.length < 3) {
        diags.push({
            type: "error",
            message: `Low peer count: only ${peers.length} peer${peers.length === 1 ? "" : "s"} connected`,
            detail: "Healthy nodes should have 10+ peers. Check firewall and seed configuration.",
        })
    }

    // Peers with no RPC (unknown)
    const noRpc = peers.filter(p => !p.rpcAddr || p.rpcAddr === "")
    if (noRpc.length > 0) {
        diags.push({
            type: "warn",
            message: `${noRpc.length} peer${noRpc.length === 1 ? "" : "s"} with unknown/closed RPC`,
            detail: noRpc.map(p => p.moniker || p.nodeId?.slice(0, 8) || "?").join(", "),
        })
    }

    // Peers behind (if we have height info)
    if (localHeight > 0) {
        const behind = peers.filter(p => {
            const h = p.remoteHeight
            return typeof h === "number" && h > 0 && localHeight - h > 2
        })
        if (behind.length > 0) {
            diags.push({
                type: "warn",
                message: `${behind.length} peer${behind.length === 1 ? " is" : "s are"} behind`,
                detail: behind.map(p => `${p.moniker || p.nodeId?.slice(0, 8) || "?"} (h=${p.remoteHeight})`).join(", "),
            })
        }
    }

    // Chain not advancing. gnomonitoring's `is_stuck` replaces the old round-age
    // check, which never fired: it read a client-side parser that threw on every
    // chain. A node that still answers is not a chain that is still committing.
    if (consensus?.isStuck) {
        diags.push({
            type: "error",
            message: "Chain is not advancing",
            detail: `Height ${consensus.height.toLocaleString()} (round ${consensus.round}) has stopped moving: nodes still answer, but no new blocks are being committed.`,
        })
    }

    // Past round 0 means earlier rounds at this height failed to commit — usually a
    // proposer or precommit timeout. Round 0 is normal; 3 or more is persistent.
    if (consensus && consensus.round > 0) {
        diags.push({
            type: consensus.round >= 3 ? "error" : "warn",
            message: `Consensus on round ${consensus.round} (expected round 0)`,
            detail: `${consensus.round} round${consensus.round === 1 ? "" : "s"} at height ${consensus.height.toLocaleString()} failed to commit.`,
        })
    }

    // Deliberately NOT ported: the prevote / precommit "below BFT threshold" alerts.
    // They were gated on how long the current round had been running, which the
    // chain-health payload does not carry. Without that gate a snapshot taken
    // mid-round is almost always partial, so they would fire on nearly every
    // refresh. `is_stuck` covers the failure they existed to catch.

    // No peers at all
    if (peers.length === 0 && netInfo) {
        diags.push({
            type: "error",
            message: "No peers connected — node is isolated",
            detail: "Node cannot participate in consensus without peers. Check network configuration.",
        })
    }

    return diags
}

/** Derive alert-level diagnostics from monitoring incidents (v2.17.0). */
function deriveIncidentDiagnostics(incidents: MonitoringIncident[]): Diagnostic[] {
    if (!incidents || incidents.length === 0) return []

    return incidents
        .filter(inc => inc.severity?.toUpperCase() === "CRITICAL" || inc.severity?.toUpperCase() === "WARNING")
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, 5)
        .map(inc => ({
            type: inc.severity?.toUpperCase() === "CRITICAL" ? "error" as const : "warn" as const,
            message: `${inc.severity?.toUpperCase()}: ${inc.moniker || inc.addr} — ${inc.details || "incident detected"}`,
            detail: inc.timestamp ? `at ${new Date(inc.timestamp).toLocaleString()}` : undefined,
        }))
}

export function DoctorPanel({ netInfo, consensus, localHeight, incidents = [] }: DoctorPanelProps) {
    const networkDiags = deriveDiagnostics(netInfo, consensus, localHeight)
    const incidentDiags = deriveIncidentDiagnostics(incidents)
    const diags = [...incidentDiags, ...networkDiags] // incidents first (higher priority)

    return (
        <div className="hk-card hk-doctor" style={{ gridColumn: "1 / -1" }}>
            <div className="hk-card__title">
                <span className="hk-card__icon">🩺</span>
                DOCTOR
                {diags.length === 0 && <span className="hk-badge hk-badge--ok" style={{ marginLeft: "auto" }}>ALL OK</span>}
            </div>
            {diags.length === 0 ? (
                <div className="hk-doctor__ok">
                    <span>No issues detected. Network appears healthy.</span>
                </div>
            ) : (
                <div className="hk-doctor__alerts">
                    {diags.map((d, i) => (
                        <div key={i} className={`hk-doctor__alert hk-doctor__alert--${d.type}`}>
                            <div className="hk-doctor__alert-msg">
                                {d.type === "error" ? "🔴" : "🟡"} {d.message}
                            </div>
                            {d.detail && (
                                <div className="hk-doctor__alert-detail">
                                    → {d.detail}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}
