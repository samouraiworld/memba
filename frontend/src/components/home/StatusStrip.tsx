/**
 * StatusStrip — thin brand/network heartbeat bar for the Control Room home.
 *
 * Displays: メンバー wordmark · chain label · live dot · block height · validators.
 * Data sourced from useNetwork() (chain label) and useNetworkPulse() (live stats).
 *
 * @module components/home/StatusStrip
 */

import { useNetwork } from "../../hooks/useNetwork"
import { useNetworkPulse } from "../../hooks/home/useNetworkPulse"
import "./home.css"

export function StatusStrip() {
    const { label } = useNetwork()
    const { blockHeight, totalValidators, loading, offline } = useNetworkPulse()

    // Truthful dot: offline (RPC error) → distinct state, never a "live" dot.
    const dotState = offline ? "offline" : loading ? "syncing" : "live"
    const dotModifier = offline ? " status-strip__dot--offline" : loading ? " status-strip__dot--syncing" : ""

    return (
        <div className="status-strip" data-testid="status-strip">
            <span className="status-strip__wordmark">メンバー</span>
            <span className="status-strip__sep" aria-hidden="true">·</span>
            <span className="status-strip__chain">{label}</span>
            <span
                className={`status-strip__dot${dotModifier}`}
                role="img"
                aria-label={dotState}
                title={dotState}
            />
            {!loading && !offline && (
                <>
                    {/* Honesty: omit the block-height chip when height is 0/falsy
                        (chain not yet producing blocks or data not yet arrived). */}
                    {!!blockHeight && (
                        <span className="status-strip__stat" data-testid="status-block-height">
                            #{blockHeight.toLocaleString()}
                        </span>
                    )}
                    {/* Honesty: omit the validator chip when count is 0/undefined.
                        A bare "0v" contradicts the NetworkHealthDoor which shows a real
                        count; omitting is cleaner than showing a misleading zero. */}
                    {!!totalValidators && (
                        <>
                            <span className="status-strip__sep" aria-hidden="true">·</span>
                            <span className="status-strip__stat" data-testid="status-validators">
                                {totalValidators}v
                            </span>
                        </>
                    )}
                </>
            )}
        </div>
    )
}
