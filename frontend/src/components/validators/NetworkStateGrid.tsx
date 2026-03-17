/**
 * NetworkStateGrid — dense Gnockpit-style network state display.
 *
 * Shows chain metadata (chain ID, AppHash, genesis, node uptime, sync status)
 * plus the recent 100-block heatmap strip.
 *
 * All fields degrade to "—" when data is null/unavailable.
 */

import type { NetworkStats } from "../../lib/validators"
import type { HackerConsensusState } from "../../lib/validators"

interface NetworkStateGridProps {
    stats: NetworkStats | null
    cs: HackerConsensusState | null
    /** Chain's seed address (optional, set via SAMOURAI_SENTRY or config) */
    seedAddr?: string
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

function genesisAge(isoStr: string): string {
    if (!isoStr) return "—"
    const ms = Date.now() - new Date(isoStr).getTime()
    if (ms < 0 || isNaN(ms)) return "—"
    const d = Math.floor(ms / 86_400_000)
    const h = Math.floor((ms % 86_400_000) / 3_600_000)
    const m = Math.floor((ms % 3_600_000) / 60_000)
    if (d > 0) return `up ${d}d ${h}h`
    if (h > 0) return `up ${h}h ${m}m`
    return `up ${m}m`
}

export function NetworkStateGrid({ stats, cs, seedAddr }: NetworkStateGridProps) {
    const chainId = cs?.chainId || stats?.chainId || "—"
    const appHash = cs?.appHash || "—"
    const genesisTime = cs?.genesisTime || "—"
    const genesisAgeStr = cs?.genesisTime ? genesisAge(cs.genesisTime) : "—"
    const totalValidators = cs?.valsetSize || stats?.totalValidators || null
    const minBft = cs?.minBft ?? null
    const margin = cs?.faultTolerance ?? null
    const canAdd = cs?.canAddValidator ?? null

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
                            ? new Date(stats.latestBlockTime).toISOString().replace("T", " ").slice(0, 19) + " UTC"
                            : "—"}
                        mono />
                    <Row label="chain" value={chainId} accent />
                    <Row label="genesis time" value={genesisTime.slice(0, 19).replace("T", " ") || "—"} mono />
                    <Row label="genesis age" value={genesisAgeStr} accent />
                    {appHash !== "—" && (
                        <Row label="apphash" value={`${appHash.slice(0, 22)}…`} mono />
                    )}
                    {seedAddr && (
                        <Row label="seed" value={seedAddr} mono />
                    )}
                </div>

                {/* Right column — consensus metadata */}
                <div className="nsg-col">
                    <Row label="avg block time" value={stats?.avgBlockTime != null ? `${stats.avgBlockTime.toFixed(1)}s` : "—"} />
                    {totalValidators != null && (
                        <Row label="valset" value={totalValidators} accent />
                    )}
                    {minBft != null && (
                        <Row label="min bft" value={minBft} />
                    )}
                    {margin != null && (
                        <Row
                            label="active validators"
                            value={`${totalValidators}/${totalValidators} (margin: +${margin})`}
                            accent
                        />
                    )}
                    {canAdd != null && (
                        <Row label="can add validator" value={canAdd ? "yes" : "no"} />
                    )}
                </div>
            </div>
        </div>
    )
}
