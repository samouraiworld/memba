/**
 * ConsensusWidget — live Tendermint consensus state viewer.
 *
 * Shows the current Height / Round / Step, proposer address,
 * Pre-vote and Pre-commit progress bars, and fault tolerance info.
 *
 * Returns null (renders nothing) when consensus data is unavailable —
 * elegant fallback for chains/nodes that don't expose /dump_consensus_state.
 */

import type { HackerConsensusState } from "../../lib/validators"

interface ConsensusWidgetProps {
    cs: HackerConsensusState | null
    /** Whether data is being fetched (drives the pulse animation) */
    loading: boolean
}

function StepBar({ label, count, total, color }: {
    label: string
    count: number
    total: number
    color: "pv" | "pc"
}) {
    const pct = total > 0 ? Math.min(100, Math.round((count / total) * 100)) : 0
    const bftPct = total > 0 ? Math.round(((Math.ceil(total * 2 / 3)) / total) * 100) : 67

    return (
        <div className="cs-bar" data-color={color}>
            <div className="cs-bar__header">
                <span className="cs-bar__label">{label}</span>
                <span className="cs-bar__count">{count}<span className="cs-bar__total">/{total}</span></span>
            </div>
            <div className="cs-bar__track" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                <div className="cs-bar__fill" style={{ width: `${pct}%` }} />
                {/* BFT threshold marker */}
                <div className="cs-bar__bft-marker" style={{ left: `${bftPct}%` }} title={`BFT threshold: ${Math.ceil(total * 2 / 3)}/${total}`} />
            </div>
        </div>
    )
}

export function ConsensusWidget({ cs, loading }: ConsensusWidgetProps) {
    if (!cs && !loading) return null

    return (
        <div className={`hk-card hk-consensus ${loading && !cs ? "hk-card--loading" : ""}`} id="hk-consensus-widget">
            <div className="hk-card__title">
                <span className="hk-card__icon">⬡</span>
                CONSENSUS STATE
                {loading && <span className="hk-pulse" aria-label="Updating…" />}
            </div>

            {cs ? (
                <div className="hk-consensus__body">
                    {/* H/R/S row */}
                    <div className="hk-hrs">
                        <div className="hk-hrs__cell">
                            <span className="hk-hrs__label">H</span>
                            <span className="hk-hrs__value">{cs.height.toLocaleString()}</span>
                        </div>
                        <div className="hk-hrs__sep">/</div>
                        <div className="hk-hrs__cell">
                            <span className="hk-hrs__label">R</span>
                            <span className="hk-hrs__value">{cs.round}</span>
                        </div>
                        <div className="hk-hrs__sep">/</div>
                        <div className="hk-hrs__cell">
                            <span className="hk-hrs__label">S</span>
                            <span className={`hk-hrs__value hk-step--${cs.stepLabel.toLowerCase()}`}>
                                {cs.step}
                            </span>
                        </div>
                        <div className="hk-hrs__step-label">{cs.stepLabel}</div>
                    </div>

                    {/* Proposer */}
                    <div className="hk-meta-row">
                        <span className="hk-meta-key">proposer</span>
                        <span className="hk-meta-val hk-mono hk-proposer">
                            {cs.proposer
                                ? `${cs.proposer.slice(0, 12)}…${cs.proposer.slice(-6)}`
                                : "—"}
                        </span>
                    </div>

                    {/* Valset details */}
                    <div className="hk-meta-row">
                        <span className="hk-meta-key">valset</span>
                        <span className="hk-meta-val">{cs.valsetSize}</span>
                        <span className="hk-meta-key">min bft</span>
                        <span className="hk-meta-val hk-accent">{cs.minBft}</span>
                        <span className="hk-meta-key">margin</span>
                        <span className={`hk-meta-val ${cs.faultTolerance <= 1 ? "hk-warn" : "hk-ok"}`}>
                            +{cs.faultTolerance}
                        </span>
                    </div>

                    {/* Round age */}
                    {cs.roundAge != null && (
                        <div className="hk-meta-row">
                            <span className="hk-meta-key">round age</span>
                            <span className={`hk-meta-val hk-mono ${
                                cs.roundAge > 30 ? "hk-danger" : cs.roundAge > 5 ? "hk-warn" : "hk-ok"
                            }`}>
                                {cs.roundAge}s
                            </span>
                        </div>
                    )}

                    {/* AppHash */}
                    {cs.appHash && (
                        <div className="hk-meta-row">
                            <span className="hk-meta-key">apphash</span>
                            <span className="hk-meta-val hk-mono hk-dimmed">
                                {cs.appHash.slice(0, 20)}…
                            </span>
                        </div>
                    )}

                    {/* Genesis age */}
                    {cs.genesisTime && (
                        <div className="hk-meta-row">
                            <span className="hk-meta-key">genesis</span>
                            <span className="hk-meta-val hk-dimmed">{cs.genesisTime.slice(0, 19).replace("T", " ")} UTC</span>
                        </div>
                    )}

                    {/* Vote bars */}
                    <div className="cs-bars">
                        <StepBar label="PV" count={cs.prevoteCount} total={cs.valsetSize} color="pv" />
                        <StepBar label="PC" count={cs.precommitCount} total={cs.valsetSize} color="pc" />
                    </div>
                </div>
            ) : (
                <div className="hk-unavail">
                    <span className="hk-unavail__icon">⚠</span>
                    Consensus state unavailable for this RPC endpoint
                </div>
            )}
        </div>
    )
}
