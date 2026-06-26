/**
 * NetworkProofCard — the hero's live "proof object" (editorial direction).
 *
 * Fills the right side of the visitor hero with evidence the product is alive:
 * the current block height (hero-scale, tabular figures), validator count and
 * block cadence — straight from useNetworkPulse. Honest states: a skeleton while
 * loading, and an "offline" label (never fabricated numbers) when the network
 * can't be reached. avgBlockTime/validators are each omitted when 0.
 *
 * @module components/home/NetworkProofCard
 */
import { useNetworkPulse } from "../../hooks/home/useNetworkPulse"
import "./home.css"

export function NetworkProofCard() {
    const { blockHeight, avgBlockTime, totalValidators, loading, offline } = useNetworkPulse()
    const unavailable = offline || (!loading && !blockHeight)

    return (
        <aside className="hero-proof" data-testid="hero-proof" aria-label="Live network status">
            <span className="hero-proof__label">
                <span className={`hero-proof__dot ${unavailable ? "is-offline" : "is-live"}`} aria-hidden="true" />
                network · {unavailable ? "offline" : "live"}
            </span>

            {unavailable ? (
                <span className="hero-proof__empty">Network status unavailable</span>
            ) : loading ? (
                <span className="hero-proof__height hero-proof__height--skeleton" aria-hidden="true" />
            ) : (
                <>
                    <span className="hero-proof__height">{blockHeight.toLocaleString()}</span>
                    <span className="hero-proof__meta">
                        {totalValidators > 0 && <>{totalValidators} validators</>}
                        {totalValidators > 0 && avgBlockTime > 0 && <span aria-hidden="true"> · </span>}
                        {avgBlockTime > 0 && <>~{avgBlockTime.toFixed(1)}s block</>}
                    </span>
                </>
            )}
        </aside>
    )
}
