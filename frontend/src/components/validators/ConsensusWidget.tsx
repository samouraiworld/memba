/**
 * ConsensusWidget — live consensus state for the telemetry view.
 *
 * HISTORY WORTH KEEPING. This card rendered NOTHING on every chain for the life
 * of the feature. Its data source parsed /dump_consensus_state client-side and
 * threw on the first field it touched (`round_state.votes` is an object; the
 * code called `.find` on it), the TypeError was swallowed by a catch, the source
 * returned null — and the component's own `if (!cs && !loading) return null`
 * then removed the card from the DOM entirely, leaving a hole in the grid rather
 * than the "unavailable" message it already had written.
 *
 * Two consequences shape this file:
 *   1. It never returns null. A telemetry card that vanishes teaches the reader
 *      nothing; one that says it has no data teaches them where to look.
 *   2. Its data now comes from gnomonitoring's chain-health endpoint, which
 *      parses consensus server-side against a stable REST contract instead of a
 *      node-internal debug dump with no schema guarantee.
 *
 * The trade, stated plainly: step, proposer and the prevote tally are not in the
 * REST payload and are gone from this card. On paper that is a reduction; in
 * practice it is not, because none of them has ever appeared on screen.
 */

import type { ConsensusView } from "../../lib/chainHealthApi"

interface ConsensusWidgetProps {
    view: ConsensusView | null
    /** Whether data is being fetched (drives the pulse animation). */
    loading: boolean
}

/** Precommit progress against the BFT threshold. */
function PrecommitBar({ count, total }: { count: number; total: number }) {
    const pct = total > 0 ? Math.min(100, Math.round((count / total) * 100)) : 0
    // The marker sits at the validator-count equivalent of the 2/3 power
    // threshold. It is an approximation whenever weights differ — the exact
    // threshold is in voting power and shown as `quorum` below.
    const bftPct = total > 0 ? Math.round(((Math.ceil((total * 2) / 3)) / total) * 100) : 67

    return (
        <div className="cs-bar" data-color="pc">
            <div className="cs-bar__header">
                <span className="cs-bar__label">PRECOMMITS</span>
                <span className="cs-bar__count">{count}<span className="cs-bar__total">/{total}</span></span>
            </div>
            <div
                className="cs-bar__track"
                role="progressbar"
                aria-label={`${count} of ${total} validators have precommitted`}
                aria-valuenow={pct}
                aria-valuemin={0}
                aria-valuemax={100}
            >
                <div className="cs-bar__fill" style={{ width: `${pct}%` }} />
                <div className="cs-bar__bft-marker" style={{ left: `${bftPct}%` }} />
            </div>
        </div>
    )
}

export function ConsensusWidget({ view, loading }: ConsensusWidgetProps) {
    return (
        <div className={`hk-card hk-consensus ${loading && !view ? "hk-card--loading" : ""}`} id="hk-consensus-widget">
            <div className="hk-card__title">
                <span className="hk-card__icon">⬡</span>
                CONSENSUS STATE
                {loading && <span className="hk-pulse" aria-label="Updating…" />}
            </div>

            {view ? (
                <div className="hk-consensus__body">
                    {/* Height / round */}
                    <div className="hk-hrs">
                        <div className="hk-hrs__cell">
                            <span className="hk-hrs__label">H</span>
                            <span className="hk-hrs__value">{view.height.toLocaleString()}</span>
                        </div>
                        <div className="hk-hrs__sep">/</div>
                        <div className="hk-hrs__cell">
                            <span className="hk-hrs__label">R</span>
                            <span className="hk-hrs__value">{view.round}</span>
                        </div>
                        {/* A round above zero means the previous one failed to
                            commit — worth seeing, not worth alarming over. */}
                        {view.round > 0 && <div className="hk-hrs__step-label hk-warn">round &gt; 0</div>}
                    </div>

                    {/* A reachable RPC is not a live chain: the node answers 200
                        while the height sits still. */}
                    {view.isStuck && (
                        <div className="hk-meta-row">
                            <span className="hk-meta-key">liveness</span>
                            <span className="hk-meta-val hk-danger">CHAIN NOT ADVANCING</span>
                        </div>
                    )}

                    <div className="hk-meta-row">
                        <span className="hk-meta-key">valset</span>
                        <span className="hk-meta-val">{view.valsetSize}</span>
                        <span className="hk-meta-key">power</span>
                        <span className="hk-meta-val hk-mono">{view.totalVotingPower.toLocaleString()}</span>
                    </div>

                    {/* quorum is VOTING POWER, not a validator count — the units
                        coincide only while every validator carries equal weight. */}
                    <div className="hk-meta-row">
                        <span className="hk-meta-key">quorum</span>
                        <span className="hk-meta-val hk-accent hk-mono">{view.quorum.toLocaleString()}</span>
                        <span className="hk-meta-key">tolerates</span>
                        <span className={`hk-meta-val ${view.faultTolerance < 1 ? "hk-danger" : view.faultTolerance === 1 ? "hk-warn" : "hk-ok"}`}>
                            {view.faultTolerance} failure{view.faultTolerance === 1 ? "" : "s"}
                        </span>
                    </div>

                    {/* At zero tolerance any single validator can halt the chain,
                        and a halted chain cannot govern itself back. Say so. */}
                    {view.faultTolerance < 1 && view.valsetSize > 0 && (
                        <div className="hk-meta-row">
                            <span className="hk-meta-val hk-danger">
                                Any single validator going offline would halt consensus.
                            </span>
                        </div>
                    )}

                    <div className="hk-meta-row">
                        <span className="hk-meta-key">peers</span>
                        <span className="hk-meta-val">{view.peerCount}</span>
                    </div>

                    <div className="cs-bars">
                        <PrecommitBar count={view.precommitCount} total={view.valsetSize} />
                    </div>
                </div>
            ) : (
                <div className="hk-unavail">
                    <span className="hk-unavail__icon">⚠</span>
                    {loading ? "Loading consensus state…" : "Consensus state unavailable — monitoring did not answer for this chain"}
                </div>
            )}
        </div>
    )
}
