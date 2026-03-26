/**
 * DoctorPanel — derives network health alerts from already-fetched data.
 * NO additional RPC calls — 100% derived from state passed by parent.
 *
 * Alert types:
 * - Peers with unknown/closed RPC
 * - Peers that are KO behind (height < localHeight - 2)
 * - Low peer count (< 3)
 * - Consensus round stuck (round age > 30s)
 */

import type { NetInfo, HackerConsensusState } from "../../lib/validators"
import type { MonitoringIncident } from "../../lib/gnomonitoring"

interface Diagnostic {
    type: "warn" | "error"
    message: string
    detail?: string
}

interface DoctorPanelProps {
    netInfo: NetInfo | null
    cs: HackerConsensusState | null
    localHeight: number
    /** v2.17.0: monitoring incidents from gnomonitoring */
    incidents?: MonitoringIncident[]
}

function deriveDiagnostics(netInfo: NetInfo | null, cs: HackerConsensusState | null, localHeight: number): Diagnostic[] {
    const diags: Diagnostic[] = []

    if (!netInfo && !cs) return diags

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

    // Consensus round stuck
    if (cs?.roundAge != null && cs.roundAge > 30) {
        diags.push({
            type: "error",
            message: `Consensus round appears stuck (round age: ${cs.roundAge}s)`,
            detail: `Expected new block every ~3s. Current: h=${cs.height} r=${cs.round} s=${cs.step}`,
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

export function DoctorPanel({ netInfo, cs, localHeight, incidents = [] }: DoctorPanelProps) {
    const networkDiags = deriveDiagnostics(netInfo, cs, localHeight)
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
